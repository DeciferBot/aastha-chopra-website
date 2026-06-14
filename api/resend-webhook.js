/**
 * Resend webhook — the mailbox-level safety net for autosend.
 *
 *   email.bounced / email.complained  -> brand.email_status = 'bounced'
 *                                        (autosend gate then skips it forever) and
 *                                        the pipeline row is marked bounced.
 *   email.opened / email.clicked       -> bump pipeline open/click counters so the
 *                                        Telegram `status` reflects real engagement.
 *
 * Security: Svix-signed (Resend uses Svix). Verified with RESEND_WEBHOOK_SECRET.
 * Fails CLOSED — if the secret is unset or the signature is bad, nothing is applied,
 * so the endpoint is safe to deploy before the webhook is registered.
 *
 * Body parsing is disabled so we can verify the signature over the exact raw bytes.
 */

import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WH_SECRET    = process.env.RESEND_WEBHOOK_SECRET; // whsec_...

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

/** Verify a Svix signature header against the raw payload. */
function verify(secret, headers, payload) {
  const id = headers['svix-id'];
  const ts = headers['svix-timestamp'];
  const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64');
  const exp = Buffer.from(expected);
  // Header is a space-separated list of "v1,<base64sig>".
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const got = Buffer.from(sig);
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}

async function applyEvent(p_email_id, p_type, p_to) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_email_event`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_email_id, p_type, p_to }),
  });
  if (!res.ok) console.error('apply_email_event failed:', await res.text());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!WH_SECRET) { console.error('RESEND_WEBHOOK_SECRET not set — rejecting'); return res.status(500).end(); }

  const payload = await readRaw(req);
  if (!verify(WH_SECRET, req.headers, payload)) return res.status(401).end();

  let evt;
  try { evt = JSON.parse(payload); } catch { return res.status(400).end(); }

  const type = evt?.type;
  const data = evt?.data || {};
  const to = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);

  if (['email.bounced', 'email.complained', 'email.opened', 'email.clicked'].includes(type)) {
    await applyEvent(data.email_id || null, type, to);
  }
  // Always 200 for any other (delivered, sent, etc.) so Resend stops retrying.
  return res.status(200).json({ ok: true });
}
