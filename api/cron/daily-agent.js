/**
 * Daily Outreach Agent — Vercel Cron
 * Runs at 2:00 UTC (6:00 AM UAE time) every day.
 * Scores brands, generates pitches for top 3 grounded in LIVE Instagram numbers,
 * stores them in brand_pitches, and emails one forward-ready pitch per brand.
 * GET /api/cron/daily-agent
 */

import { getLiveProfile } from '../_profile.js';
import { generatePitch, sendPitchEmail } from '../_pitch.js';

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const FB_TOKEN      = process.env.FB_ACCESS_TOKEN;
const AASTHA_EMAIL  = 'aasthac8@gmail.com';

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
  const top = scored.slice(0, 3);

  // Generate, store, and deliver one forward-ready pitch per top brand.
  await Promise.all(top.map(async (r) => {
    const { subject, body } = await generatePitch(r.brand.name, profile, r.brand.notes || '');
    r.subject = subject;
    r.body = body;
    if (dryRun) return;
    r.pitchId = await storePitch({ brand: r.brand, subject, body, score: r.score, adData: r.adData, profile });
    await sendPitchEmail({ to: AASTHA_EMAIL, brand: r.brand, subject, body, score: r.score, adData: r.adData });
    await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'emailed', emailed_at: new Date().toISOString() }),
    });
  }));

  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true, groundedOn: profile,
      pitches: top.map((r) => ({
        brand: r.brand.name, score: r.score,
        recipient: r.brand.contact_email || '(no contact on file)',
        subject: r.subject, body: r.body,
      })),
    });
  }

  res.status(200).json({
    ok: true,
    brandsChecked: brands.length,
    emailedTo: AASTHA_EMAIL,
    pitches: top.map((r) => ({ brand: r.brand.name, score: r.score, subject: r.subject })),
    groundedOn: { followers: profile.followers, uaeFollowers: profile.uaeFollowers, uaeReach: profile.uaeReach, asOf: profile.asOf },
  });
}
