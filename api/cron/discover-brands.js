/**
 * Brand Discovery Agent — Vercel Cron
 *
 * Sweeps the Meta Ad Library for UAE brands actively running ads across
 * Aastha's niches, then inserts genuinely-new ones into `outreach_brands`
 * so the daily-agent picks them up for scoring + pitching.
 *
 * The signal that separates a real UAE advertiser from global dropship/short-drama
 * noise is currency === 'AED'. The `ad_reached_countries=AE` filter alone is far
 * too noisy (it returns any ad that merely reached the UAE).
 *
 * IMPORTANT — token requirement:
 *   The commercial Ad Library search needs a Meta access token tied to an account
 *   with at least one ACTIVE ad account and `ads_read`. Set FB_ACCESS_TOKEN in the
 *   Vercel project env. Without it this cron exits cleanly as a no-op.
 *   NOTE: it is unverified whether the classic graph.facebook.com/ads_archive REST
 *   surface returns commercial (non-political) ads for a stored token the way the
 *   interactive Meta Ads MCP does. Verify on first deploy via ?dryRun=1 (below)
 *   before enabling the schedule in vercel.json.
 *
 * Manual / verify:  GET /api/cron/discover-brands?dryRun=1   (Bearer CRON_SECRET)
 *   dryRun returns what it WOULD insert without writing to the DB.
 *
 * GET /api/cron/discover-brands
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const FB_TOKEN     = process.env.FB_ACCESS_TOKEN;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const AASTHA_EMAIL = 'aasthac8@gmail.com';

// Niche search terms → category. Tuned to Aastha's lifestyle/fashion/beauty/wellness fit.
const NICHE_QUERIES = [
  { term: 'fashion boutique',     category: 'fashion' },
  { term: 'modest fashion abaya', category: 'modest-fashion' },
  { term: 'skincare beauty',      category: 'beauty' },
  { term: 'wellness spa',         category: 'wellness' },
  { term: 'perfume fragrance',    category: 'fragrance' },
  { term: 'jewellery',            category: 'jewellery' },
  { term: 'activewear gym',       category: 'fitness-fashion' },
];

// Pages whose names match these are almost always dropshippers / non-brand spam.
const JUNK_PATTERNS = [
  /\b(tv|drama|novel|episode|chapter|watch|story)\b/i,
  /\b(alibaba|aliexpress|wholesale|factory|supplier)\b/i,
];

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

// One Ad Library search. Returns the raw ad rows (with currency + page fields).
async function searchAdLibrary(searchTerm) {
  const params = new URLSearchParams({
    search_terms: searchTerm,
    ad_type: 'ALL',
    ad_reached_countries: '["AE"]',
    ad_active_status: 'ACTIVE',
    limit: '50',
    fields: 'id,page_id,page_name,currency,ad_delivery_start_time,ad_snapshot_url',
    access_token: FB_TOKEN,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(`Ad Library (${searchTerm}): ${data.error.message}`);
  return data.data || [];
}

function isJunk(pageName = '') {
  return JUNK_PATTERNS.some((re) => re.test(pageName));
}

// Collapse many ads → one row per AED-billed UAE page, keeping the freshest ad.
function collapseToBrands(ads, category) {
  const byPage = new Map();
  for (const ad of ads) {
    if (ad.currency !== 'AED') continue;          // the UAE-advertiser signal
    if (!ad.page_id || !ad.page_name) continue;
    if (isJunk(ad.page_name)) continue;
    const existing = byPage.get(ad.page_id);
    const started = ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time).getTime() : 0;
    if (!existing || started > existing._started) {
      byPage.set(ad.page_id, {
        page_id: ad.page_id,
        name: ad.page_name.trim(),
        category,
        sample_ad: ad.ad_snapshot_url,
        _started: started,
      });
    }
  }
  return [...byPage.values()];
}

async function emailSummary(inserted) {
  if (!RESEND_KEY || !inserted.length) return;
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai',
  });
  const lines = inserted.map((b) => `• ${b.name} (${b.category}) — ${b.sample_ad}`);
  const body = [
    `Good morning Aastha,`,
    ``,
    `${inserted.length} new UAE brand${inserted.length === 1 ? '' : 's'} found running active Meta ads today:`,
    ``,
    ...lines,
    ``,
    `They're queued in your watchlist and will be scored + pitched in tomorrow's digest.`,
    ``,
    `Outreach Bot`,
  ].join('\n');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Outreach Bot <onboarding@resend.dev>',
      to: AASTHA_EMAIL,
      subject: `${inserted.length} new UAE brands discovered — ${date}`,
      text: body,
    }),
  });
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  const dryRun = req.query?.dryRun === '1';

  if (!FB_TOKEN) {
    return res.status(200).json({
      ok: false,
      note: 'FB_ACCESS_TOKEN not set — discovery is a no-op. Add an ads_read token to enable.',
    });
  }

  // 1. Sweep every niche, collapse to one row per AED-billed page.
  const found = new Map();
  const errors = [];
  for (const { term, category } of NICHE_QUERIES) {
    try {
      const ads = await searchAdLibrary(term);
      for (const brand of collapseToBrands(ads, category)) {
        if (!found.has(brand.page_id)) found.set(brand.page_id, brand);
      }
    } catch (e) {
      errors.push(e.message);
    }
    await new Promise((r) => setTimeout(r, 400)); // be gentle on the API
  }
  const candidates = [...found.values()];

  // 2. Drop pages already in the watchlist (dedupe by page_id).
  const known = await sb('/outreach_brands?select=page_id&page_id=not.is.null');
  const knownIds = new Set(known.map((r) => r.page_id));
  const fresh = candidates.filter((b) => !knownIds.has(b.page_id));

  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true, candidates: candidates.length,
      wouldInsert: fresh.length, sample: fresh.slice(0, 25), errors,
    });
  }

  // 3. Insert fresh brands as 'discovered' so the daily-agent scores + pitches them.
  let inserted = [];
  if (fresh.length) {
    const today = new Date().toISOString().slice(0, 10);
    inserted = await sb('/outreach_brands', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify(fresh.map((b) => ({
        name: b.name,
        category: b.category,
        niche_fit: 'medium',          // unscored default; daily-agent + a human refine it
        ad_status: 'active',          // found via ACTIVE filter
        last_checked: today,
        source: 'discovered',
        page_id: b.page_id,
        discovered_at: new Date().toISOString(),
        last_ad_data: { found_via: 'ad_library_discovery', sample_ad: b.sample_ad },
      }))),
    });
  }

  await emailSummary(inserted.map((r, i) => ({ ...r, sample_ad: fresh[i]?.sample_ad })));

  res.status(200).json({
    ok: true, candidates: candidates.length, inserted: inserted.length, errors,
  });
}
