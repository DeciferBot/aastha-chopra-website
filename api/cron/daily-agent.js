/**
 * Daily Outreach Agent — Vercel Cron
 * Runs at 2:00 UTC (6:00 AM UAE time) every day.
 * Scores brands, generates pitches for top 3 grounded in LIVE Instagram numbers,
 * stores them in brand_pitches, and emails one forward-ready pitch per brand.
 * GET /api/cron/daily-agent
 */

import { getLiveProfile } from '../_profile.js';
import { generatePitch, sendPitchEmail, sendBrandPitch, autosendEnabled } from '../_pitch.js';

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const FB_TOKEN      = process.env.FB_ACCESS_TOKEN;
// REVIEW MODE: when OUTREACH_REDIRECT_TO is set, every pitch is delivered to that
// single inbox (forward-ready) and NOTHING goes to a brand — Aastha reviews/forwards.
// Unset it to let autosend deliver straight to brands.
const REDIRECT_TO   = process.env.OUTREACH_REDIRECT_TO || '';
const AASTHA_EMAIL  = REDIRECT_TO || 'aasthac8@gmail.com';

// Autonomy controls (all overridable via env, sane defaults baked in)
const DAILY_LIMIT   = Number(process.env.OUTREACH_DAILY_LIMIT  || 3);   // fresh pitches per run
const COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS || 30);  // don't re-pitch within N days
const MIN_AUTOSEND  = Number(process.env.OUTREACH_MIN_SCORE     || 5);   // min fit score to send to brand
// Which tiers may be auto-sent to the brand directly. Default warm+paid; reach is
// never cold-emailed. Set e.g. OUTREACH_TIERS=warm to restrict the first wave.
const AUTOSEND_TIERS = (process.env.OUTREACH_TIERS || 'warm,paid').split(',').map((t) => t.trim());

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
  if (adData?.active)            score += 3;
  if (adData?.recentCount > 0)   score += 2;
  if (brand.niche_fit === 'high')   score += 3;
  if (brand.niche_fit === 'medium') score += 1;
  if (brand.contact_email)       score += 1;
  return Math.min(score, 10);
}

/**
 * Persist a generated pitch so the analytics tab / on-demand "send me this pitch"
 * button can re-deliver it without regenerating, and so we keep an audit trail of
 * exactly which live numbers each pitch quoted.
 */
async function storePitch({ brand, subject, body, score, adData, profile }) {
  const rows = await sb('/brand_pitches', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      brand_id: brand.id,
      brand_name: brand.name,
      category: brand.category,
      subject,
      body,
      to_email: brand.contact_email || null,
      to_confidence: brand.contact_email ? 'verified' : 'none',
      grounded_stats: profile,
      score,
      ad_count: adData?.count ?? null,
      status: 'draft',
    }]),
  });
  return rows?.[0]?.id ?? null;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const allowed = auth === `Bearer ${process.env.CRON_SECRET}` || auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`;
  if (!allowed) return res.status(401).end();

  // dryRun: ground + generate the real pitches and return them, but write nothing
  // and email nothing. Use this to preview a forward-ready pitch before the live cron.
  const dryRun = req.query?.dryRun === '1';

  const brands = await sb('/outreach_brands?is_agency=eq.false&select=*');
  if (!brands.length) {
    return res.status(200).json({ ok: true, note: 'No brands in watchlist' });
  }

  // Ground every pitch in Aastha's real, current Instagram numbers — once per run.
  const profile = await getLiveProfile();

  const today = new Date().toISOString().slice(0, 10);
  const scored = [];

  for (const brand of brands) {
    const adData = await checkAdLibrary(brand.name);
    const score = scoreBrand(brand, adData);

    if (!dryRun) {
      await sb(`/outreach_brands?id=eq.${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ad_status: adData?.active ? 'active' : adData === null ? 'unknown' : 'none',
          fit_score: score,
          last_checked: today,
          last_ad_data: adData,
        }),
      });
    }

    scored.push({ brand, adData, score });
    await new Promise(r => setTimeout(r, dryRun ? 0 : 300));
  }

  scored.sort((a, b) => b.score - a.score);

  // Cadence guard: never re-pitch a brand already contacted within the cooldown.
  // Rotates the agent through the watchlist instead of spamming the same top names.
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();
  const recent = await sb(`/brand_pitches?select=brand_id&created_at=gte.${since}`).catch(() => []);
  const onCooldown = new Set((recent || []).map((p) => p.brand_id));
  const eligible = scored.filter((r) => !onCooldown.has(r.brand.id));
  const top = eligible.slice(0, DAILY_LIMIT);

  // Route each pitch. AUTOSEND (verified sender + not paused + has a contact +
  // a real fit score + not a reach/seeding-tier brand) → straight to the brand,
  // replies + BCC to management. Otherwise fall back to Aastha's forward-ready inbox.
  // Review mode (OUTREACH_REDIRECT_TO set) forces every pitch to the one inbox.
  const canAutosend = autosendEnabled() && !REDIRECT_TO;
  await Promise.all(top.map(async (r) => {
    const { subject, body } = await generatePitch(r.brand.name, profile, r.brand.notes || '');
    r.subject = subject;
    r.body = body;

    const toBrand = canAutosend
      && !!r.brand.contact_email
      && r.brand.tier !== 'reach'
      && AUTOSEND_TIERS.includes(r.brand.tier)
      && r.score >= MIN_AUTOSEND;
    r.route = toBrand ? 'brand' : 'aastha';

    if (dryRun) return;

    r.pitchId = await storePitch({ brand: r.brand, subject, body, score: r.score, adData: r.adData, profile });

    if (toBrand) {
      await sendBrandPitch({ to: r.brand.contact_email, subject, body });
      await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', to_email: r.brand.contact_email, emailed_at: new Date().toISOString() }),
      });
    } else {
      await sendPitchEmail({ to: AASTHA_EMAIL, brand: r.brand, subject, body, score: r.score, adData: r.adData });
      await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'emailed', emailed_at: new Date().toISOString() }),
      });
    }
  }));

  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true, autosend: canAutosend, groundedOn: profile,
      eligibleAfterCooldown: eligible.length,
      pitches: top.map((r) => ({
        brand: r.brand.name, tier: r.brand.tier, score: r.score, route: r.route,
        recipient: r.route === 'brand' ? r.brand.contact_email : `${AASTHA_EMAIL} (forward-ready)`,
        subject: r.subject, body: r.body,
      })),
    });
  }

  res.status(200).json({
    ok: true,
    brandsChecked: brands.length,
    autosend: canAutosend,
    onCooldown: onCooldown.size,
    sentToBrand: top.filter((r) => r.route === 'brand').map((r) => r.brand.name),
    forwardedToAastha: top.filter((r) => r.route === 'aastha').map((r) => r.brand.name),
    groundedOn: { followers: profile.followers, uaeFollowers: profile.uaeFollowers, uaeReach: profile.uaeReach, asOf: profile.asOf },
  });
}
