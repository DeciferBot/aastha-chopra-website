/**
 * On-demand pitch — powers the "Send me this pitch" button on the analytics tab.
 *
 * Resolves the brand from outreach_brands (by page_id, else name), grounds a fresh
 * pitch in Aastha's live Instagram numbers, stores it in brand_pitches, and emails
 * the forward-ready pitch to her inbox within seconds. Uses the brand's last stored
 * ad data so the click stays fast (no live Ad Library round-trip).
 *
 * Auth: the analytics_auth cookie (set by /api/analytics-auth). Same-origin only.
 * POST { name, page_id?, category? }
 */

import { getLiveProfile } from './_profile.js';
import { generatePitch, sendPitchEmail } from './_pitch.js';
import { recordPipeline } from './_pipeline.js';

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const AASTHA_EMAIL = 'aasthac8@gmail.com';

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
  return res.json();
}

const enc = (v) => encodeURIComponent(v);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Gate on the same cookie the analytics tab is unlocked with.
  const cookie = req.headers.cookie || '';
  if (!/(?:^|;\s*)analytics_auth=1(?:;|$)/.test(cookie)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { name, page_id, category } = body;
  if (!name && !page_id) return res.status(400).json({ ok: false, error: 'name or page_id required' });

  try {
    // 1. Resolve the full brand row (has contact_email, notes, score, last ad data).
    let brands = [];
    if (page_id) brands = await sb(`/outreach_brands?page_id=eq.${enc(page_id)}&limit=1&select=*`);
    if (!brands.length && name) brands = await sb(`/outreach_brands?name=eq.${enc(name)}&limit=1&select=*`);

    // Fall back to a minimal brand if it isn't in the watchlist yet.
    const brand = brands[0] || { id: null, name, category: category || null, contact_email: null, notes: null, fit_score: null, last_ad_data: null };
    const adData = brand.last_ad_data || null;

    // 2. Ground + generate.
    const profile = await getLiveProfile();
    const { subject, body: pitchBody } = await generatePitch(brand.name, profile, brand.notes || '');

    // 3. Persist.
    let pitchId = null;
    try {
      const rows = await sb('/brand_pitches', {
        method: 'POST',
        body: JSON.stringify([{
          brand_id: brand.id,
          brand_name: brand.name,
          category: brand.category,
          subject,
          body: pitchBody,
          to_email: brand.contact_email || null,
          to_confidence: brand.contact_email ? 'verified' : 'none',
          grounded_stats: profile,
          score: brand.fit_score ?? null,
          ad_count: adData?.count ?? null,
          status: 'emailed',
        }]),
      });
      pitchId = rows?.[0]?.id ?? null;
    } catch { /* non-fatal: still deliver the email */ }

    // 4. Deliver the forward-ready pitch to her inbox.
    const resendId = await sendPitchEmail({ to: AASTHA_EMAIL, brand, subject, body: pitchBody, score: brand.fit_score, adData });

    // 5. Track it in the pipeline ('queued' = awaiting her forward).
    await recordPipeline({ brandName: brand.name, contactEmail: brand.contact_email, subject, body: pitchBody, status: 'queued', resendId, route: 'aastha-ondemand' });

    return res.status(200).json({ ok: true, brand: brand.name, subject, pitchId, groundedOn: { followers: profile.followers, uaeFollowers: profile.uaeFollowers, uaeReach: profile.uaeReach } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
