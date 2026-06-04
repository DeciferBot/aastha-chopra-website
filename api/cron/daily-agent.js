/**
 * Daily Outreach Agent — Vercel Cron
 * Runs at 2:00 UTC (6:00 AM UAE time) every day.
 * Scores brands, sends Telegram digest.
 * GET /api/cron/daily-agent
 */

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const FB_TOKEN      = process.env.FB_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API           = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTg(text) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  });
}

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

async function checkAdLibrary(brandName) {
  if (!FB_TOKEN) return null;
  try {
    const params = new URLSearchParams({
      search_terms: brandName,
      ad_type: 'ALL',
      ad_reached_countries: '["AE"]',
      ad_active_status: 'ACTIVE',
      limit: '10',
      fields: 'id,page_name,ad_delivery_start_time',
      access_token: FB_TOKEN,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
    const data = await res.json();
    if (data.error || !data.data) return null;
    const ads = data.data;
    const now = Date.now();
    const recentAds = ads.filter(ad => {
      if (!ad.ad_delivery_start_time) return false;
      return (now - new Date(ad.ad_delivery_start_time).getTime()) < 14 * 24 * 60 * 60 * 1000;
    });
    return { active: ads.length > 0, count: ads.length, recentCount: recentAds.length };
  } catch { return null; }
}

function scoreBrand(brand, adData) {
  let score = 0;
  if (adData?.active)         score += 3;
  if (adData?.recentCount > 0) score += 2;
  if (brand.niche_fit === 'high')   score += 3;
  if (brand.niche_fit === 'medium') score += 1;
  if (brand.contact_email)   score += 1;
  return Math.min(score, 10);
}

export default async function handler(req, res) {
  // Verify this is called by Vercel cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const brands = await sb('/outreach_brands?is_agency=eq.false&select=*');
  if (!brands.length) {
    await sendTg('⚠️ Brand watchlist is empty. Add brands with `add BrandName`');
    return res.status(200).end();
  }

  const today = new Date().toISOString().slice(0, 10);
  const scored = [];

  for (const brand of brands) {
    const adData = await checkAdLibrary(brand.name);
    const score = scoreBrand(brand, adData);

    await sb(`/outreach_brands?id=eq.${brand.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ad_status: adData?.active ? 'active' : adData === null ? 'unknown' : 'none',
        fit_score: score,
        last_checked: today,
        last_ad_data: adData,
      }),
    });

    scored.push({ brand, adData, score });
    await new Promise(r => setTimeout(r, 300));
  }

  scored.sort((a, b) => b.score - a.score);

  // Urgent alerts (score 7+, not alerted today)
  for (const r of scored.filter(r => r.score >= 7)) {
    if (r.brand.last_alerted_date === today) continue;
    await sendTg([
      `🎯 *URGENT: ${r.brand.name}* — ${r.score}/10`,
      r.adData?.active ? `Running ${r.adData.count} active UAE ads${r.adData.recentCount ? ` (${r.adData.recentCount} new this week)` : ''}` : '',
      ``,
      `Reply \`pitch ${r.brand.name}\` to generate pitch.`,
    ].filter(Boolean).join('\n'));
    await sb(`/outreach_brands?id=eq.${r.brand.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_alerted_date: today }),
    });
  }

  // Morning digest — top 3
  const top = scored.slice(0, 3);
  const lines = [`☀️ *Good morning! Top ${top.length} opportunities today*\n`];
  top.forEach((r, i) => {
    const adNote = r.adData?.active ? `${r.adData.count} active UAE ads` : 'No ad data yet';
    lines.push(`*${i + 1}. ${r.brand.name}* — ${r.score}/10`);
    lines.push(`   ${r.brand.category} · ${adNote}`);
    lines.push('');
  });
  lines.push(`Reply *1*, *2*, or *3* — or \`pitch BrandName\` for any brand.`);

  await sendTg(lines.join('\n'));
  res.status(200).json({ ok: true, brandsChecked: brands.length });
}
