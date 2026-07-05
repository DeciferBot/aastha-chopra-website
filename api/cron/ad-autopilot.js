export const config = { maxDuration: 120 };

/**
 * Ad Autopilot — Vercel Cron
 *
 * Autonomous "boost the winners" engine for @aastha_sochic.
 *
 * Each run:
 *   1. Reads her best-performing recent organic post from Supabase
 *      (highest engagement-rate-on-reach in the last 45 days, with a reach floor),
 *      skipping posts already boosted in the last 21 days.
 *   2. Promotes that EXISTING Instagram post as an ad (keeps its organic
 *      likes/comments as social proof) inside the single capped campaign.
 *   3. Pauses the previously-active ad so only ONE ad runs at a time.
 *   4. Logs the decision to `ad_autopilot_runs`.
 *
 * SAFETY — spend is capped three ways:
 *   - Structural: ONE campaign, daily_budget hard-asserted to 1000 cents (10 AED)
 *     every run. CBO means total daily spend can never exceed this regardless of
 *     how many ads exist. 10 AED/day ≈ 300 AED/month = the approved ceiling.
 *   - Kill-switch: does nothing unless AD_AUTOPILOT_ENABLED === 'true'.
 *   - Dry-run: with AD_AUTOPILOT_DRYRUN === 'true' it selects + resolves but
 *     never creates/activates anything (use for the first manual test).
 *
 * GET /api/cron/ad-autopilot   (Bearer CRON_SECRET or MANUAL_SYNC_KEY)
 */

import {
  resolveIgUserId,
  resolveMediaByShortcode,
  shortcodeOf,
  existingPostCreativeBody,
} from '../_igpromote.js';

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const FB_BASE      = 'https://graph.facebook.com/v21.0';

// Fixed assets (see project_meta_ads / project_meta_business_portfolios memory)
const AD_ACCOUNT   = '1508208884141959';          // act_ prefix added where needed
const CAMPAIGN_ID  = '120247258501960261';         // "Autopilot — Boost Winners"
const ADSET_ID     = '120247260470810261';         // "UAE Women — Post Engagement v2" (ON_POST)
const PAGE_ID      = '109895657605220';            // aastha_sochic
const IG_USER_ID   = '17841400363033312';          // @aastha_sochic IG business account (fallback)

// Hard spend cap — never raised by this code.
const DAILY_BUDGET_CENTS = 1000;                   // 10 AED/day
const REACH_FLOOR        = 300;                    // ignore posts that barely reached anyone
const LOOKBACK_DAYS      = 45;                     // candidate window
const RECENTLY_BOOSTED_DAYS = 21;                  // don't re-boost the same post too soon

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${opts.method || 'GET'} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function fbGet(path) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB GET ${path}: ${data.error.message}`);
  return data;
}

async function fbPost(path, body) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const res = await fetch(`${FB_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB POST ${path}: ${data.error.message}`);
  return data;
}

// ── Step 1: pick the current winner from Supabase ─────────────────────────────
async function pickWinner() {
  // Posts already boosted recently — exclude them so we rotate fresh content.
  const recent = await sb(
    `/ad_autopilot_runs?status=eq.boosted&ran_at=gte.${
      new Date(Date.now() - RECENTLY_BOOSTED_DAYS * 864e5).toISOString()
    }&select=winner_post_id`
  );
  const excluded = new Set((recent || []).map(r => r.winner_post_id).filter(Boolean));

  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  // Pull a handful of top candidates; filter/score in JS (PostgREST can't do the
  // computed eng-rate ordering cleanly here).
  const rows = await sb(
    `/instagram_posts?timestamp=gte.${since}&reach=gte.${REACH_FLOOR}` +
    `&select=id,permalink,media_type,caption,storage_image_url,original_media_url,timestamp,reach,like_count,comments_count,saved,shares` +
    `&order=reach.desc&limit=60`
  );
  const scored = (rows || [])
    .filter(p => !excluded.has(p.id))
    .map(p => {
      const eng = (p.like_count || 0) + (p.comments_count || 0) + (p.saved || 0) + (p.shares || 0);
      return { ...p, eng, eng_rate: p.reach ? (eng / p.reach) * 100 : 0 };
    })
    .sort((a, b) => b.eng_rate - a.eng_rate);

  return scored[0] || null;
}

// ── Step 3: find the currently-active ad in the ad set (to pause it) ───────────
async function currentActiveAds() {
  const data = await fbGet(`/${ADSET_ID}/ads?fields=id,name,status&limit=50`);
  return (data.data || []).filter(a => a.status === 'ACTIVE');
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const ok = auth === `Bearer ${process.env.CRON_SECRET}` ||
             (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!ok) return res.status(401).end();

  const enabled = process.env.AD_AUTOPILOT_ENABLED === 'true';
  const dryRun  = process.env.AD_AUTOPILOT_DRYRUN === 'true';

  const logRun = (row) =>
    sb('/ad_autopilot_runs', { method: 'POST', body: JSON.stringify([row]) }).catch(() => {});

  // Kill-switch: never touches ads unless explicitly enabled.
  if (!enabled) {
    await logRun({ status: 'disabled', detail: 'AD_AUTOPILOT_ENABLED is not "true" — no-op.' });
    return res.status(200).json({ ok: true, status: 'disabled' });
  }

  if (!process.env.META_ADS_ACCESS_TOKEN) {
    await logRun({ status: 'error', detail: 'Missing META_ADS_ACCESS_TOKEN.' });
    return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });
  }

  try {
    // 1. Pick winner
    const winner = await pickWinner();
    if (!winner) {
      await logRun({ status: 'skipped', detail: 'No eligible winner in lookback window.' });
      return res.status(200).json({ ok: true, status: 'skipped', reason: 'no winner' });
    }

    // 2. Parse the winner's shortcode — needed to resolve its ad-side media id.
    const shortcode = shortcodeOf(winner.permalink);
    const base = {
      winner_post_id: winner.id,
      winner_permalink: winner.permalink,
      winner_eng_rate: Number(winner.eng_rate.toFixed(1)),
      daily_budget_cents: DAILY_BUDGET_CENTS,
    };
    if (!shortcode) {
      await logRun({ ...base, status: 'error', detail: `Could not parse a shortcode from permalink ${winner.permalink}.` });
      return res.status(200).json({ ok: false, status: 'error', reason: 'no shortcode' });
    }

    // 3. Resolve the IG identity + the post's real media id (in the
    //    source_instagram_media_id namespace — see ../_igpromote.js).
    const igUserId = await resolveIgUserId(PAGE_ID, IG_USER_ID);
    const media = await resolveMediaByShortcode(igUserId, shortcode);

    if (dryRun) {
      await logRun({ ...base, status: 'skipped',
        detail: `DRY RUN — would boost existing post ${winner.permalink} (${winner.eng_rate.toFixed(1)}% eng).` });
      return res.status(200).json({ ok: true, status: 'dry-run', winner: { ...base, ig_user_id: igUserId, media_id: media.id } });
    }

    // 4. Re-assert the hard budget cap before anything goes live.
    await fbPost(`/${CAMPAIGN_ID}`, { daily_budget: DAILY_BUDGET_CENTS });

    // 5. Build the creative by promoting the EXISTING post — its organic
    //    likes/comments stay on the real post and grow as social proof.
    const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, existingPostCreativeBody({
      name: `Autopilot creative — ${winner.permalink}`,
      pageId: PAGE_ID,
      igUserId,
      mediaId: media.id,
    }));

    // 6. Pause the previously-active ad(s) — keep exactly one running.
    const prev = await currentActiveAds();
    for (const a of prev) {
      await fbPost(`/${a.id}`, { status: 'PAUSED' }).catch(() => {});
    }

    // 7. Create the new ad, active.
    const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
      name: `Boost ${winner.permalink} (${winner.eng_rate.toFixed(0)}% eng)`,
      adset_id: ADSET_ID,
      creative: { creative_id: creative.id },
      status: 'ACTIVE',
    });

    // 8. Make sure the ad set + campaign are live (idempotent).
    await fbPost(`/${ADSET_ID}`, { status: 'ACTIVE' }).catch(() => {});
    await fbPost(`/${CAMPAIGN_ID}`, { status: 'ACTIVE' }).catch(() => {});

    await logRun({
      ...base, status: 'boosted', ad_id: ad.id,
      prev_ad_id: prev[0]?.id || null,
      detail: `Boosted ${winner.permalink} @ ${DAILY_BUDGET_CENTS / 100} AED/day; paused ${prev.length} old ad(s).`,
    });

    return res.status(200).json({ ok: true, status: 'boosted', ad_id: ad.id, winner: base });
  } catch (err) {
    await logRun({ status: 'error', detail: err.message });
    return res.status(500).json({ error: err.message });
  }
}
