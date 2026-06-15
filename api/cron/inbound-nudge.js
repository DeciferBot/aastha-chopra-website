/**
 * Inbound-lead nudge — Vercel Cron.
 * Each morning, re-surfaces OPEN inbound brand enquiries (contact_briefs.status='new')
 * to Telegram so a real lead never goes stale. The real-time alert (brief-notify edge
 * function) fires once on submission; this is the standing reminder until Aastha either
 * replies and marks it done (`done BrandName`) or it converts.
 *
 * Silent when there are no open leads. GET /api/cron/inbound-nudge
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS  = (process.env.TELEGRAM_ALLOWED_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
  return res.json();
}

async function tg(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const allowed = auth === `Bearer ${process.env.CRON_SECRET}` || (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!allowed) return res.status(401).end();

  const leads = await sb('/contact_briefs?status=eq.new&order=created_at.desc&select=brand,email,category,budget,collab_type,created_at');

  if (!leads.length) return res.status(200).json({ ok: true, openLeads: 0, nudged: false });

  const lines = leads.map((l) => {
    const date = (l.created_at || '').slice(0, 10);
    const budget = l.budget ? l.budget : 'budget not specified';
    return `🟡 ${l.brand} (${date}) — ${l.collab_type || 'collab'} · ${budget}\n   reply: ${l.email || '—'}`;
  });

  const msg = [
    `📥 ${leads.length} open inbound lead${leads.length === 1 ? '' : 's'} awaiting reply`,
    ``,
    lines.join('\n'),
    ``,
    `Type "leads" for full details, or "done BrandName" once you have replied.`,
  ].join('\n');

  // Telegram DM chat_id equals the user id for users who have started the bot.
  const recipients = ALLOWED_IDS.length ? ALLOWED_IDS : [];
  await Promise.all(recipients.map((id) => tg(id, msg)));

  res.status(200).json({ ok: true, openLeads: leads.length, nudged: recipients.length });
}
