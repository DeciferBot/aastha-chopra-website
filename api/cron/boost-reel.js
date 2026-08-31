export const config = { maxDuration: 300 };

/**
 * Boost Reel — one-shot manual endpoint
 *
 * Promotes ONE chosen organic reel/post of @aastha_sochic as an ad
 * (profile-visit goal) for follower growth.
 *
 * Engagement stays on the REAL post: the ad promotes the EXISTING Instagram post
 * by id (object_id + instagram_user_id + source_instagram_media_id) rather than
 * re-uploading its video, so likes/comments/views consolidate onto the actual
 * post as social proof. Shared mechanism lives in ../_igpromote.js.
 *
 * Correctness by cloning: clones the known-good reel profile-visit reference ad
 * set (optimization_goal / destination_type / promoted_object / targeting),
 * audience AE+SA · women · 25–45.
 *
 * Safety: builds PAUSED. ?activate=1 to go live. ?dryrun=1 plans only.
 * GET /api/cron/boost-reel?code=SHORTCODE[&dryrun=1][&activate=1][&budget=1500]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

import {
  resolveIgUserId,
  resolveMediaByShortcode,
  existingPostCreativeBody,
} from '../_igpromote.js';
import { fbGet, fbPost, fbDelete } from '../_meta-graph.js';

const AD_ACCOUNT       = '1508208884141959';
const PAGE_ID          = '109895657605220';
const IG_USER_FALLBACK = '17841400363033312'; // @aastha_sochic, if the Page lookup is empty
const REF_ADSET        = '120247276442590261'; // proven VISIT_INSTAGRAM_PROFILE reel ad set
const REF_CAMPAIGN     = '120247276440520261';

const DEFAULT_BUDGET_CENTS = 1500; // 15 AED/day

function buildTargeting(t = {}) {
  const out = {
    geo_locations: { countries: ['AE', 'SA'] },
    genders: [2], age_min: 25, age_max: 45,
    targeting_automation: { advantage_audience: 0 },
  };
  for (const k of ['publisher_platforms', 'facebook_positions', 'instagram_positions', 'device_platforms']) {
    if (Array.isArray(t[k]) && t[k].length) out[k] = t[k];
  }
  return out;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.MANUAL_SYNC_KEY]
    .filter(Boolean).some((k) => auth === `Bearer ${k}`);
  if (!ok) return res.status(401).end();
  if (!process.env.META_ADS_ACCESS_TOKEN) return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });

  const code = req.query?.code;
  if (!code) return res.status(400).json({ error: 'Missing ?code=SHORTCODE' });
  const dryRun = req.query?.dryrun === '1';
  const activate = req.query?.activate === '1';
  const budget = Math.max(369, parseInt(req.query?.budget, 10) || DEFAULT_BUDGET_CENTS);
  // Optional ?suffix= tags the campaign name so a rebuild sits alongside an
  // existing live campaign for the same reel instead of colliding with it.
  const suffix = (req.query?.suffix || '').toString().trim();
  const campaignName = `Boost Reel — ${code} (Jun 2026)${suffix ? ` [${suffix}]` : ''}`;
  // Stay well under the function's own 300s ceiling so a retry can always
  // detect it's out of time and fail cleanly instead of being killed mid-write.
  const deadline = Date.now() + 260000;

  try {
    const igUserId = await resolveIgUserId(PAGE_ID, IG_USER_FALLBACK);
    const [media, refAdset, refCampaign] = await Promise.all([
      resolveMediaByShortcode(igUserId, code),
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CAMPAIGN}?fields=objective`),
    ]);

    if (dryRun) {
      return res.status(200).json({ ok: true, status: 'dry-run', plan: {
        code, ig_user_id: igUserId, media_id: media.id, media_type: media.media_type, permalink: media.permalink,
        optimization_goal: refAdset.optimization_goal, budget: `${budget / 100} AED/day`, activate,
      } });
    }

    // Idempotency: remove any prior PAUSED campaign with this exact name. Never
    // deletes an ACTIVE (live, spending) campaign — that would be destructive.
    const camps = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name,effective_status&limit=200`);
    for (const c of (camps.data || []).filter((x) => x.name === campaignName && x.effective_status !== 'ACTIVE')) {
      await fbDelete(`/${c.id}`).catch(() => {});
    }

    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: campaignName,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED',
    }, deadline);

    const adsetBody = {
      name: `Boost Reel — ${code} (UAE+KSA Women)`,
      campaign_id: campaign.id,
      daily_budget: budget,
      billing_event: refAdset.billing_event,
      bid_strategy: refAdset.bid_strategy,
      optimization_goal: refAdset.optimization_goal,
      destination_type: refAdset.destination_type,
      targeting: buildTargeting(refAdset.targeting),
      status: 'PAUSED',
    };
    if (refAdset.promoted_object)  adsetBody.promoted_object  = refAdset.promoted_object;
    if (refAdset.attribution_spec) adsetBody.attribution_spec = refAdset.attribution_spec;
    const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, adsetBody, deadline);

    // Promote the EXISTING post — engagement lands on the real reel.
    const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, existingPostCreativeBody({
      name: `Reel boost creative (${code})`,
      pageId: PAGE_ID,
      igUserId,
      mediaId: media.id,
    }), deadline);

    const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
      name: `Boost Reel — ${code}`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED',
    }, deadline);

    await fbPost(`/${adset.id}`, { daily_budget: budget }, deadline);
    if (activate) {
      await fbPost(`/${campaign.id}`, { status: 'ACTIVE' }, deadline);
      await fbPost(`/${adset.id}`,    { status: 'ACTIVE' }, deadline);
      await fbPost(`/${ad.id}`,       { status: 'ACTIVE' }, deadline);
    }

    return res.status(200).json({
      ok: true, status: activate ? 'launched-live' : 'built-paused',
      code, permalink: media.permalink,
      campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id, media_id: media.id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
