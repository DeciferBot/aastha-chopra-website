export const config = { maxDuration: 300 };

/**
 * Outreach Agent — Vercel Cron (daily at 02:00 UTC, 06:00 UAE)
 *
 * Rebuilt 2026-08-31 to the "few, sharp, true" rules:
 *   - At most 5 email pitches per rolling 7 days (shared with the on-demand
 *     "send me this pitch" button via _outreach-shared.js's weeklyQuota()),
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
 * Hardened 2026-08-31 (code review): every per-brand step is isolated so one
 * bad reply from the writer or checker can no longer crash the whole run — it
 * is recorded and the next candidate is tried. A pitch that fails to SEND is
 * marked 'failed' (not left stuck at 'draft' forever, which used to silently
 * burn a week's quota and block the brand for 45 days on a pitch nobody ever
 * received — two real brands were found stuck this way).
 *
 * Routing is unchanged: review mode (OUTREACH_REDIRECT_TO set) delivers a
 * forward-ready email to Aastha's inbox; autosend to brands stays gated behind
 * OUTREACH_FROM + OUTREACH_PAUSE and never touches reach-tier brands.
 *
 * GET /api/cron/daily-agent[?dryRun=1]
 */

import { getLiveProfile } from '../_profile.js';
import { generatePitch, sendPitchEmail, sendBrandPitch, autosendEnabled, buildFactSheet, brandFactsText } from '../_pitch.js';
import { checkText } from '../_accuracy.js';
import { recordPipeline } from '../_pipeline.js';
import { sb, OUTREACH_SEGMENTS, BUDGET_WEIGHT, byBudgetThenScore, weeklyQuota } from '../_outreach-shared.js';

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
const COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS || 45);
const MIN_AUTOSEND  = Number(process.env.OUTREACH_MIN_SCORE     || 5);
const AUTOSEND_TIERS = (process.env.OUTREACH_TIERS || 'warm,paid').split(',').map((t) => t.trim());

// How many top candidates get a fresh Ad Library timing check each run.
const AD_CHECK_LIMIT = 25;

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
 * Never throws: a writer/checker error is treated the same as a rejection, so
 * one bad reply drops this brand and moves on instead of killing the run.
 */
async function generateCheckedPitch(brand, profile) {
  const factSheet = buildFactSheet(profile);
  const facts = `BRAND FACTS (the only brand facts that exist): ${brandFactsText(brand.name, brand.brand_brief)}
HER STATS (the only numbers allowed):\n${factSheet || '(none, so the pitch may cite no numbers)'}`;
  let feedback = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { subject, body } = await generatePitch(brand.name, profile, brand.brand_brief, brand.segment || '', feedback);
      const verdict = await checkText({ text: `${subject}\n${body}`, facts, factSheet });
      if (verdict.ok) return { subject, body, attempts: attempt + 1 };
      feedback = `Your previous attempt was rejected by the fact checker: ${verdict.problems.join('; ')}. Fix every one. Only use the supplied brand facts and stats.`;
    }
  } catch (e) {
    return { subject: null, body: null, attempts: 0, error: String(e?.message || e) };
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

  // Weekly quota first — shared with the on-demand "send me this pitch"
  // button, so a manual burst of sends can't silently zero out today's
  // automated budget without anyone knowing.
  const quota = await weeklyQuota();
  // A dry run delivers nothing, so it previews the next real run even while
  // the weekly limit is spent.
  if (quota.remaining <= 0 && !dryRun) {
    return res.status(200).json({ ok: true, note: `weekly limit reached (${quota.used}/${quota.limit}); no pitch today` });
  }
  const budget = dryRun ? PER_RUN : Math.min(PER_RUN, quota.remaining);

  // Eligibility is absolute: checked address + researched brief + her segments
  // + warm/paid tier. A brand missing any of these cannot be pitched at all.
  // Quality bar (Amit, 2026-08-31): only names people have heard of get
  // chased at all. Mid and small brands stay stored but get no slots.
  const candidates = await sb(
    `/outreach_brands?is_agency=eq.false&tier=in.(warm,paid)` +
    `&budget_tier=eq.major` +
    `&segment=in.(${OUTREACH_SEGMENTS.join(',')})` +
    `&contact_email=not.is.null&email_status=in.(mx_ok,verified)` +
    `&brand_brief=not.is.null&select=*`
  );
  if (!candidates.length) {
    return res.status(200).json({ ok: true, note: 'no eligible brands (checked address + brief + segment + tier)' });
  }

  // Cooldown: never re-pitch a brand contacted (any real channel) inside the
  // window. A 'failed' row (nothing actually delivered) does not count.
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86400000).toISOString();
  const recent = await sb(`/brand_pitches?select=brand_id&generated_at=gte.${since}&status=neq.failed`).catch(() => []);
  const onCooldown = new Set((recent || []).map((p) => p.brand_id));
  const pool = candidates.filter((b) => !onCooldown.has(b.id));
  if (!pool.length) {
    return res.status(200).json({ ok: true, note: 'all eligible brands are on cooldown' });
  }

  // Ground every pitch in Aastha's real, current numbers — once per run.
  const profile = await getLiveProfile();

  // Timing signal: refresh the Ad Library read for a rotating slice of the
  // pool. Sorted by staleness (never-checked first), NOT by the brand's own
  // stored score — sorting on the very field this loop writes would let a
  // brand that misses the cut once fall out of rotation forever.
  const { token: adToken, reason: adTokenReason } = await resolveAdToken();
  const today = new Date().toISOString().slice(0, 10);
  const scored = [];
  const toCheck = pool
    .sort((a, b) => {
      const aChecked = a.last_checked ? new Date(a.last_checked).getTime() : 0;
      const bChecked = b.last_checked ? new Date(b.last_checked).getTime() : 0;
      return aChecked - bChecked; // never-checked, then stalest, first
    })
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
  scored.sort(byBudgetThenScore);

  const canAutosend = autosendEnabled() && !REDIRECT_TO;
  const delivered = [];
  const rejected = [];
  const sendFailed = [];

  // Walk candidates in score order until the budget is spent. A pitch that the
  // accuracy engine rejects twice, or that errors while writing/checking, is
  // dropped and the next brand is tried — never crashes the run.
  for (const r of scored) {
    if (delivered.length >= budget) break;
    const checked = await generateCheckedPitch(r.brand, profile);
    if (!checked) { rejected.push(r.brand.name); continue; }
    if (checked.error) { rejected.push({ brand: r.brand.name, reason: checked.error }); continue; }
    r.subject = checked.subject;
    r.body = checked.body;
    r.attempts = checked.attempts;

    const toBrand = canAutosend
      && !!r.brand.contact_email?.trim()
      && ['mx_ok', 'verified'].includes(r.brand.email_status)
      && r.brand.tier !== 'reach'
      && AUTOSEND_TIERS.includes(r.brand.tier)
      && r.score >= MIN_AUTOSEND;
    r.route = toBrand ? 'brand' : 'aastha';

    if (dryRun) { delivered.push(r); continue; }

    let pitchId = null;
    try {
      pitchId = await storePitch({ brand: r.brand, subject: r.subject, body: r.body, score: r.score, adData: r.adData, profile });
      r.pitchId = pitchId;
      if (toBrand) {
        const resendId = await sendBrandPitch({ to: r.brand.contact_email, subject: r.subject, body: r.body });
        await sb(`/brand_pitches?id=eq.${pitchId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'sent', to_email: r.brand.contact_email, emailed_at: new Date().toISOString() }),
        });
        await recordPipeline({ brandName: r.brand.name, contactEmail: r.brand.contact_email, subject: r.subject, body: r.body, status: 'sent', resendId, route: 'brand' });
      } else {
        const resendId = await sendPitchEmail({ to: AASTHA_EMAIL, brand: r.brand, subject: r.subject, body: r.body, score: r.score, adData: r.adData });
        await sb(`/brand_pitches?id=eq.${pitchId}`, {
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
      // Mark the row 'failed' so it stops counting toward the weekly quota
      // and the cooldown — a pitch nobody ever received must not silently
      // burn a week's budget or block the brand for 45 days.
      if (pitchId) {
        await sb(`/brand_pitches?id=eq.${pitchId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'failed' }),
        }).catch(() => {});
      }
      sendFailed.push({ brand: r.brand.name, reason: r.sendError });
    }
  }

  return res.status(200).json({
    ok: true,
    dryRun,
    weeklyQuota: `${quota.used + (dryRun ? 0 : delivered.length)}/${quota.limit}`,
    eligible: pool.length,
    adSignal: { tokenReason: adTokenReason, checked: scored.length },
    autosend: canAutosend,
    rejectedByChecks: rejected,
    sendFailed,
    pitches: delivered.map((r) => ({
      brand: r.brand.name, tier: r.brand.tier, score: r.score, attempts: r.attempts, route: r.route,
      recipient: r.route === 'brand' ? r.brand.contact_email : `${AASTHA_EMAIL} (forward-ready)`,
      subject: r.subject, ...(dryRun ? { body: r.body } : {}),
    })),
  });
}
