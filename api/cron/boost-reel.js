export const config = { maxDuration: 300 };

/**
 * Boost Reel — one-shot manual endpoint
 *
 * Promotes ONE chosen organic REEL of @aastha_sochic as a fresh video ad
 * (profile-visit goal) for follower growth. The Marketing API can't "boost" an
 * existing IG post, so we rebuild it from the reel's video file — same proven
 * path as launch-reels.js, but for a single caller-chosen reel.
 *
 * Identity + correctness-by-cloning: clones the known-good reel profile-visit
 * reference (ad set + creative object_story_spec), swapping in this reel's
 * video + thumbnail + caption, audience AE+SA · women · 25–45.
 *
 * Safety: builds PAUSED. ?activate=1 to go live. ?dryrun=1 plans only.
 * GET /api/cron/boost-reel?code=SHORTCODE[&dryrun=1][&activate=1][&budget=1500]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY | LAUNCH_KEY
 */

import { getIgToken } from '../_igtoken.js';

const FB_BASE = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com/v21.0';

const AD_ACCOUNT   = '1508208884141959';
const REF_ADSET    = '120247276442590261'; // proven VISIT_INSTAGRAM_PROFILE reel ad set
const REF_CREATIVE = '2237800353684636';   // proven reel video creative (identity + CTA)
const REF_CAMPAIGN = '120247276440520261';

const DEFAULT_BUDGET_CENTS = 1500; // 15 AED/day

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
  if (data.error) {
    const e = data.error;
    throw new Error(`FB POST ${path}: ${e.message}` +
      (e.error_user_msg ? ` | ${e.error_user_title}: ${e.error_user_msg}` : '') +
      (e.error_subcode ? ` | subcode=${e.error_subcode}` : ''));
  }
  return data;
}

async function fbDelete(path) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${token}`, { method: 'DELETE' });
  return res.json().catch(() => ({}));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveReel(code) {
  const token = await getIgToken();
  if (!token) throw new Error('No Instagram token available');
  let media = [];
  let url = `${IG_GRAPH}/me/media?fields=id,media_type,media_url,thumbnail_url,permalink,caption&limit=100&access_token=${token}`;
  while (url && media.length < 500) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(`IG media: ${data.error.message}`);
    media = media.concat(data.data || []);
    url = data.paging?.next || null;
  }
  const m = media.find((x) => {
    const mt = (x.permalink || '').match(/\/(?:reel|p|tv)\/([^/]+)\//);
    return mt && mt[1] === code;
  });
  if (!m) throw new Error(`Reel ${code} not found in last 500 media`);
  if (m.media_type !== 'VIDEO') throw new Error(`Post ${code} is ${m.media_type}, not VIDEO`);
  if (!m.media_url) throw new Error(`Reel ${code} has no media_url`);
  return {
    media_id: m.id,
    media_url: m.media_url,
    thumbnail_url: m.thumbnail_url || null,
    permalink: m.permalink,
    caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 280),
  };
}

async function uploadVideo(reel) {
  const up = await fbPost(`/act_${AD_ACCOUNT}/advideos`, {
    file_url: reel.media_url, name: `Reel boost (${reel.media_id})`,
  });
  const videoId = up.id;
  if (!videoId) throw new Error('advideos returned no id');
  for (let i = 0; i < 40; i++) {
    const s = await fbGet(`/${videoId}?fields=status`);
    const vs = s.status?.video_status;
    if (vs === 'ready') return videoId;
    if (vs === 'error') throw new Error('video processing error');
    await sleep(4000);
  }
  throw new Error('video not ready after ~160s');
}

async function uploadThumb(reel) {
  if (!reel.thumbnail_url) return null;
  const r = await fetch(reel.thumbnail_url);
  if (!r.ok) return null;
  const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
  const up = await fbPost(`/act_${AD_ACCOUNT}/adimages`, { bytes: b64 });
  return Object.values(up.images || {})[0]?.hash || null;
}

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
  const campaignName = `Boost Reel — ${code} (Jun 2026)`;

  try {
    const [reel, refAdset, refCreative, refCampaign] = await Promise.all([
      resolveReel(code),
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CREATIVE}?fields=object_story_spec`),
      fbGet(`/${REF_CAMPAIGN}?fields=objective`),
    ]);

    if (dryRun) {
      return res.status(200).json({ ok: true, status: 'dry-run', plan: {
        code, permalink: reel.permalink, caption_preview: reel.caption.slice(0, 100),
        optimization_goal: refAdset.optimization_goal, budget: `${budget / 100} AED/day`, activate,
      } });
    }

    // Idempotency: remove any prior campaign with this exact name.
    const camps = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name&limit=200`);
    for (const c of (camps.data || []).filter((x) => x.name === campaignName)) {
      await fbDelete(`/${c.id}`).catch(() => {});
    }

    const [videoId, imageHash] = await Promise.all([uploadVideo(reel), uploadThumb(reel)]);

    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: campaignName,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED',
    });

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
    const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, adsetBody);

    // Clone the proven reel creative's identity/CTA, swap in this reel's media.
    const oss = JSON.parse(JSON.stringify(refCreative.object_story_spec || {}));
    oss.video_data = oss.video_data || {};
    oss.video_data.video_id = videoId;
    if (imageHash) { oss.video_data.image_hash = imageHash; delete oss.video_data.image_url; }
    oss.video_data.message = reel.caption || 'Follow @aastha_sochic ✨';
    const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, {
      name: `Reel boost creative (${code})`, object_story_spec: oss,
    });

    const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
      name: `Boost Reel — ${code}`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED',
    });

    await fbPost(`/${adset.id}`, { daily_budget: budget });
    if (activate) {
      await fbPost(`/${campaign.id}`, { status: 'ACTIVE' });
      await fbPost(`/${adset.id}`,    { status: 'ACTIVE' });
      await fbPost(`/${ad.id}`,       { status: 'ACTIVE' });
    }

    return res.status(200).json({
      ok: true, status: activate ? 'launched-live' : 'built-paused',
      code, permalink: reel.permalink,
      campaign_id: campaign.id, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id, video_id: videoId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
