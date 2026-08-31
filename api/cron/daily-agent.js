export const config = { maxDuration: 300 };

/**
 * Outreach Agent — Vercel Cron (daily at 02:00 UTC, 06:00 UAE)
 *
 * Rebuilt 2026-08-31 to the "few, sharp, true" rules:
 *   - At most OUTREACH_WEEKLY_LIMIT (5) email pitches per rolling 7 days,
 *     at most OUTREACH_DAILY_LIMIT (1) per run. Quota spent = the run exits.
 *   - A brand is eligible ONLY with a checked contact address
 *     (email_status mx_ok/verified), a researched brand_brief, tier warm/paid,
 *     and a segment Aastha actually creates in. No address or no brief means
 *     no pitch, ever.
 *   - Every pitch runs through the shared accuracy engine (_accuracy.js):
 *     hard code rules plus an independent fact-check against the brief and the
 *     live stats sheet. Fails CLOSED: a pitch that cannot pass is dropped and
 *     the next candidate is tried.
 *   - Grounded in live Instagram numbers via getLiveProfile(); the model may
 *     only cite numbers that appear in the fact sheet.
 *
 * Routing is unchanged: review mode (OUTREACH_REDIRECT_TO set) delivers a
 * forward-ready email to Aastha's inbox; autosend to brands stays gated behind
 * OUTREACH_FROM + OUTREACH_PAUSE and never touches reach-tier brands.
 *
 * GET /api/cron/daily-agent[?dryRun=1]
 */

import { getLiveProfile } from '../_profile.js';
import { generatePitch, sendPitchEmail, sendBrandPitch, autosendEnabled, buildFactSheet } from '../_pitch.js';
import { checkText } from '../_accuracy.js';
import { recordPipeline } from '../_pipeline.js';

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
// Ad Library lookups accept any valid app/user token. FB_ACCESS_TOKEN can quietly
// expire, so the ads-autopilot token (exercised weekly, stays fresh) is the
// fallback. First working one wins.
const AD_TOKENS = [...new Set(
  [process.env.FB_ACCESS_TOKEN, process.env.META_ADS_ACCESS_TOKEN].filter(Boolean)
)];
// REVIEW MODE: when OUTREACH_REDIRECT_TO is set, every pitch is delivered to that
// single inbox (forward-ready) and NOTHING goes to a brand.
const REDIRECT_TO   = process.env.OUTREACH_REDIRECT_TO || '';
const AASTHA_EMAIL  = REDIRECT_TO || 'aasthac8@gmail.com';

const PER_RUN       = Number(process.env.OUTREACH_DAILY_LIMIT   || 1);
const WEEKLY_LIMIT  = Number(process.env.OUTREACH_WEEKLY_LIMIT  || 5);
const COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS || 45);
const MIN_AUTOSEND  = Number(process.env.OUTREACH_MIN_SCORE     || 5);
const AUTOSEND_TIERS = (process.env.OUTREACH_TIERS || 'warm,paid').split(',').map((t) => t.trim());

// The segments Aastha actually creates in, weighted toward budgets that pay:
// hotels, travel, retail chains, and FMCG beauty. Cars stay out.
const PITCH_SEGMENTS = ['beauty', 'fashion', 'fragrance', 'jewellery', 'wellness', 'hospitality', 'travel', 'retail'];

// Money weighting (Amit, 2026-08-31: "focus on things that pay"). A small
// local studio only surfaces when no major or mid brand is available.
const BUDGET_WEIGHT = { major: 3, mid: 1, small: -2 };

// How many top candidates get a fresh Ad Library timing check each run.
const AD_CHECK_LIMIT = 25;

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

async function adArchive(searchTerms, token, limit = 10) {
  const params = new URLSearchParams({
    search_terms: searchTerms,
    ad_type: 'ALL',
    ad_reached_countries: '["AE"]',
    ad_active_status: 'ACTIVE',
    limit: String(limit),
    fields: 'id,page_name,ad_delivery_start_time',
    access_token: token,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
  return res.json();
}

/** Resolve a token that works against the Ad Library, once per run. */
async function resolveAdToken() {
  if (!AD_TOKENS.length) return { token: null, reason: 'no_token' };
  let reason = 'no_token';
  for (const t of AD_TOKENS) {
    try {
      const data = await adArchive('Nike', t, 1); // cheap liveness probe
      if (!data.error) return { token: t, reason: 'ok' };
      reason = data.error.message || 'api_error';
    } catch (e) {
      reason = String(e?.message || e);
    }
  }
  return { token: null, reason };
}

/**
 * Per-brand Ad Library check. Always structured:
 *   { ok:true, active, count, recentCount } | { ok:false, reason }
 */
async function checkAdLibrary(brandName, token) {
  if (!token) return { ok: false, reason: 'no_token' };
  try {
    const data = await adArchive(brandName, token, 10);
    if (data.error) return { ok: false, reason: data.error.message || 'api_error' };
    const ads = Array.isArray(data.data) ? data.data : [];
    const now = Date.now();
    const recentCount = ads.filter(ad => ad.ad_delivery_start_time &&
      (now - new Date(ad.ad_delivery_start_time).getTime()) < 14 * 24 * 60 * 60 * 1000).length;
    return { ok: true, active: ads.length > 0, count: ads.length, recentCount };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function scoreBrand(brand, adData) {
  let score = 0;
  if (adData?.ok && adData.active)          score += 3;
  if (adData?.ok && adData.recentCount > 0) score += 2;
  if (brand.niche_fit === 'high')   score += 3;
  if (brand.niche_fit === 'medium') score += 1;
  if (brand.contact_email)       score += 1;
  score += BUDGET_WEIGHT[brand.budget_tier] ?? 1;
  return Math.max(0, Math.min(score, 10));
}

/**
 * Generate a pitch, run it through the shared accuracy engine, allow one
 * corrected retry. Fails CLOSED — null means this brand sends nothing today.
 */
async function generateCheckedPitch(brand, profile) {
  const factSheet = buildFactSheet(profile);
  const facts = `BRAND FACTS (the only brand facts that exist): ${brand.brand_brief}
HER STATS (the only numbers allowed):\n${factSheet || '(none, so the pitch may cite no numbers)'}`;
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { subject, body } = await generatePitch(brand.name, profile, brand.brand_brief, brand.segment || '', feedback);
    const verdict = await checkText({ text: `${subject}\n${body}`, facts, factSheet });
    if (verdict.ok) return { subject, body, attempts: attempt + 1 };
    feedback = `Your previous attempt was rejected by the fact checker: ${verdict.problems.join('; ')}. Fix every one. Only use the supplied brand facts and stats.`;
  }
  return null;
}

/** Persist a generated pitch (audit trail + on-demand re-delivery). */
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
  const allowed = auth === `Bearer ${process.env.CRON_SECRET}` || (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!allowed) return res.status(401).end();

  // dryRun: select + generate + check for real, but write and email nothing.
  const dryRun = req.query?.dryRun === '1';

  // Weekly quota first: email pitches (any status except 'dm') in the last 7 days.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const weekRows = await sb(`/brand_pitches?select=id&generated_at=gte.${weekAgo}&status=neq.dm`).catch(() => []);
  const weekUsed = (weekRows || []).length;
  // A dry run delivers nothing, so it previews the next real run even while
  // the weekly limit is spent.
  if (weekUsed >= WEEKLY_LIMIT && !dryRun) {
    return res.status(200).json({ ok: true, note: `weekly limit reached (${weekUsed}/${WEEKLY_LIMIT}); no pitch today` });
  }
  const budget = dryRun ? PER_RUN : Math.min(PER_RUN, WEEKLY_LIMIT - weekUsed);

  // Eligibility is absolute: checked address + researched brief + her segments
  // + warm/paid tier. A brand missing any of these cannot be pitched at all.
  const candidates = await sb(
    `/outreach_brands?is_agency=eq.false&tier=in.(warm,paid)` +
    `&segment=in.(${PITCH_SEGMENTS.join(',')})` +
    `&contact_email=not.is.null&email_status=in.(mx_ok,verified)` +
    `&brand_brief=not.is.null&select=*`
  );
  if (!candidates.length) {
    return res.status(200).json({ ok: true, note: 'no eligible brands (checked address + brief + segment + tier)' });
  }

  // Cooldown: never re-pitch a brand contacted (any channel) inside the window.
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();
  const recent = await sb(`/brand_pitches?select=brand_id&generated_at=gte.${since}`).catch(() => []);
  const onCooldown = new Set((recent || []).map((p) => p.brand_id));
  const pool = candidates.filter((b) => !onCooldown.has(b.id));
  if (!pool.length) {
    return res.status(200).json({ ok: true, note: 'all eligible brands are on cooldown' });
  }

  // Ground every pitch in Aastha's real, current numbers — once per run.
  const profile = await getLiveProfile();

  // Timing signal: refresh the Ad Library read for the top of the pool only.
  const { token: adToken, reason: adTokenReason } = await resolveAdToken();
  const today = new Date().toISOString().slice(0, 10);
  const scored = [];
  const toCheck = pool
    .sort((a, b) =>
      ((BUDGET_WEIGHT[b.budget_tier] ?? 1) - (BUDGET_WEIGHT[a.budget_tier] ?? 1)) ||
      ((b.fit_score ?? 0) - (a.fit_score ?? 0)))
    .slice(0, AD_CHECK_LIMIT);
  for (const brand of toCheck) {
    const adData = adToken
      ? await checkAdLibrary(brand.name, adToken)
      : { ok: false, reason: adTokenReason };
    const score = scoreBrand(brand, adData);
    if (!dryRun) {
      await sb(`/outreach_brands?id=eq.${brand.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ad_status: adData.ok ? (adData.active ? 'active' : 'none') : 'error',
          fit_score: score,
          last_checked: today,
          last_ad_data: adData,
        }),
      });
    }
    scored.push({ brand, adData, score });
    if (adToken) await new Promise(r => setTimeout(r, 300));
  }
  scored.sort((a, b) => b.score - a.score);

  const canAutosend = autosendEnabled() && !REDIRECT_TO;
  const delivered = [];
  const rejected = [];

  // Walk candidates in score order until the budget is spent. A pitch that the
  // accuracy engine rejects twice is dropped and the next brand is tried.
  for (const r of scored) {
    if (delivered.length >= budget) break;
    const checked = await generateCheckedPitch(r.brand, profile);
    if (!checked) { rejected.push(r.brand.name); continue; }
    r.subject = checked.subject;
    r.body = checked.body;
    r.attempts = checked.attempts;

    const toBrand = canAutosend
      && ['mx_ok', 'verified'].includes(r.brand.email_status)
      && r.brand.tier !== 'reach'
      && AUTOSEND_TIERS.includes(r.brand.tier)
      && r.score >= MIN_AUTOSEND;
    r.route = toBrand ? 'brand' : 'aastha';

    if (dryRun) { delivered.push(r); continue; }

    try {
      r.pitchId = await storePitch({ brand: r.brand, subject: r.subject, body: r.body, score: r.score, adData: r.adData, profile });
      if (toBrand) {
        const resendId = await sendBrandPitch({ to: r.brand.contact_email, subject: r.subject, body: r.body });
        await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'sent', to_email: r.brand.contact_email, emailed_at: new Date().toISOString() }),
        });
        await recordPipeline({ brandName: r.brand.name, contactEmail: r.brand.contact_email, subject: r.subject, body: r.body, status: 'sent', resendId, route: 'brand' });
      } else {
        const resendId = await sendPitchEmail({ to: AASTHA_EMAIL, brand: r.brand, subject: r.subject, body: r.body, score: r.score, adData: r.adData });
        await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'emailed', emailed_at: new Date().toISOString() }),
        });
        await recordPipeline({ brandName: r.brand.name, contactEmail: r.brand.contact_email, subject: r.subject, body: r.body, status: 'queued', resendId, route: 'aastha' });
      }
      delivered.push(r);
      // Stay under Resend's rate limit between consecutive sends.
      await new Promise((rs) => setTimeout(rs, 600));
    } catch (e) {
      r.sendError = String(e?.message || e);
      console.error(`pitch send failed for ${r.brand.name}:`, r.sendError);
      rejected.push(r.brand.name);
    }
  }

  return res.status(200).json({
    ok: true,
    dryRun,
    weeklyQuota: `${weekUsed + (dryRun ? 0 : delivered.length)}/${WEEKLY_LIMIT}`,
    eligible: pool.length,
    adSignal: { tokenReason: adTokenReason, checked: scored.length },
    autosend: canAutosend,
    rejectedByChecks: rejected,
    pitches: delivered.map((r) => ({
      brand: r.brand.name, tier: r.brand.tier, score: r.score, attempts: r.attempts, route: r.route,
      recipient: r.route === 'brand' ? r.brand.contact_email : `${AASTHA_EMAIL} (forward-ready)`,
      subject: r.subject, ...(dryRun ? { body: r.body } : {}),
    })),
  });
}
