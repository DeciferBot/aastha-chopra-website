export const config = { maxDuration: 300 };

/**
 * Launch Carousel — one-shot manual endpoint
 *
 * Promotes ONE chosen organic CAROUSEL of @aastha_sochic (default: the
 * M·A·C × Sephora launch-night collab) as a fresh multi-image carousel ad,
 * optimized for Instagram profile visits → follower growth.
 *
 * Why this exists / how it differs from launch-reels.js & ad-autopilot.js:
 *   - The Marketing API cannot "boost" an existing IG post (UI-only), so we
 *     rebuild the post as a brand-new carousel creative from its child images.
 *   - launch-reels handles VIDEO reels (one ad set each); ad-autopilot promotes
 *     a single auto-winner IMAGE. This promotes a CALLER-CHOSEN carousel as a
 *     single multi-image creative.
 *   - Children are fetched LIVE from graph.instagram.com (the Supabase mirror
 *     can lag), then uploaded to /adimages for image_hash child_attachments.
 *
 * Identity: publishes as @aastha_sochic via page_id + instagram_user_id — the
 * exact pair ad-autopilot uses successfully with the production server token.
 *
 * Correctness by cloning: the ad-set optimization spec (optimization_goal /
 * billing_event / destination_type / promoted_object) is GET-cloned from a
 * known-good profile-visit reference ad set, swapping in AE+SA · women · 25–45.
 *
 * Safety:
 *   - Builds PAUSED by default. Goes live ONLY with ?activate=1, and activation
 *     happens LAST (campaign → ad set → ad). A mid-build failure spends nothing.
 *   - Per-ad-set daily budget hard-asserted to 1500 cents (15 AED/day).
 *   - ?dryrun=1 resolves the carousel + reference config and returns the plan
 *     WITHOUT creating anything (and without an IG token leak).
 *   - Idempotent: deletes any prior campaign of the same generated name first.
 *
 * GET /api/cron/launch-carousel[?code=SHORTCODE][&dryrun=1][&activate=1][&diag=1]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

import { getIgToken } from '../_igtoken.js';

const FB_BASE = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com/v21.0';

// Fixed assets (see ad-autopilot.js / project_meta_ads memory)
const AD_ACCOUNT   = '1508208884141959';
const PAGE_ID      = '109895657605220';
const IG_USER_ID   = '17841400363033312';            // @aastha_sochic IG business account
const PROFILE_LINK = 'https://www.instagram.com/aastha_sochic/';

// Known-good profile-visit reference to CLONE the ad-set spec from (the proven
// "Reel — Hiking (VISIT_IG_PROFILE)" entities also cloned by launch-reels.js).
const REF_ADSET    = '120247276442590261';
const REF_CAMPAIGN = '120247276440520261';
const REF_CREATIVE = '2237800353684636';             // for the proven profile-visit CTA

const DEFAULT_CODE = 'DZzRmJijMHL';                   // M·A·C × Sephora launch night
const DAILY_BUDGET_CENTS = 1500;                      // 15 AED/day
const MAX_CARDS = 10;                                 // Meta carousel hard cap
const CAMPAIGN_NAME = 'Sephora Collab — Profile Visits (Jun 2026)';

// ── Meta Graph helpers ────────────────────────────────────────────────────────
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

// Delete any prior campaign we created with this exact name (idempotent retries).
async function cleanupOldCampaigns() {
  const data = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name&limit=200`);
  const mine = (data.data || []).filter((c) => c.name === CAMPAIGN_NAME);
  for (const c of mine) await fbDelete(`/${c.id}`).catch(() => {});
  return mine.map((c) => c.id);
}

// ── Resolve a carousel shortcode → ordered child IMAGE urls + caption ──────────
async function resolveCarousel(code) {
  const token = await getIgToken();
  if (!token) throw new Error('No Instagram token available');

  let media = [];
  let url = `${IG_GRAPH}/me/media?fields=id,media_type,permalink,caption,children{media_type,media_url}` +
            `&limit=100&access_token=${token}`;
  while (url && media.length < 500) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(`IG media: ${data.error.message}`);
    media = media.concat(data.data || []);
    url = data.paging?.next || null;
  }

  const post = media.find((m) => {
    const mt = (m.permalink || '').match(/\/(?:reel|p|tv)\/([^/]+)\//);
    return mt && mt[1] === code;
  });
  if (!post) throw new Error(`Carousel ${code} not found in last 500 media`);
  if (post.media_type !== 'CAROUSEL_ALBUM') {
    throw new Error(`Post ${code} is ${post.media_type}, not CAROUSEL_ALBUM`);
  }

  const children = (post.children?.data || [])
    .filter((c) => c.media_type === 'IMAGE' && c.media_url)
    .map((c) => c.media_url)
    .slice(0, MAX_CARDS);
  if (children.length < 2) {
    throw new Error(`Carousel ${code} has ${children.length} usable image(s); need ≥2`);
  }

  return {
    media_id: post.id,
    permalink: post.permalink,
    caption: (post.caption || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    image_urls: children,
  };
}

// Upload one image URL → image_hash (link_data needs image_hash, not a URL).
async function uploadImage(imageUrl) {
  const r = await fetch(imageUrl);
  if (!r.ok) throw new Error(`Image fetch failed: HTTP ${r.status}`);
  const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
  const up = await fbPost(`/act_${AD_ACCOUNT}/adimages`, { bytes: b64 });
  const hash = Object.values(up.images || {})[0]?.hash;
  if (!hash) throw new Error('adimages upload returned no hash');
  return hash;
}

function buildTargeting(refTargeting) {
  const t = refTargeting || {};
  const out = {
    geo_locations: { countries: ['AE', 'SA'] },
    genders: [2],
    age_min: 25,
    age_max: 45,
    targeting_automation: { advantage_audience: 0 },
  };
  for (const k of [
    'publisher_platforms', 'facebook_positions', 'instagram_positions',
    'device_platforms', 'threads_positions',
  ]) {
    if (Array.isArray(t[k]) && t[k].length) out[k] = t[k];
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.MANUAL_SYNC_KEY]
    .filter(Boolean)
    .some((k) => auth === `Bearer ${k}`);
  if (!ok) return res.status(401).end();

  if (!process.env.META_ADS_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });
  }

  const code     = req.query?.code || DEFAULT_CODE;
  const dryRun    = req.query?.dryrun === '1';
  const activate  = req.query?.activate === '1';   // default: build PAUSED

  try {
    // 1. Resolve the carousel + reference config (parallel).
    const [carousel, refAdset, refCreative, refCampaign] = await Promise.all([
      resolveCarousel(code),
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,bid_amount,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CREATIVE}?fields=call_to_action_type`).catch(() => ({})),
      fbGet(`/${REF_CAMPAIGN}?fields=objective,buying_type`),
    ]);

    const plan = {
      code,
      permalink: carousel.permalink,
      cards: carousel.image_urls.length,
      caption_preview: carousel.caption.slice(0, 120),
      reference: {
        objective: refCampaign.objective,
        optimization_goal: refAdset.optimization_goal,
        destination_type: refAdset.destination_type,
        billing_event: refAdset.billing_event,
      },
      budget: `${DAILY_BUDGET_CENTS / 100} AED/day`,
      activate,
    };

    if (dryRun) return res.status(200).json({ ok: true, status: 'dry-run', plan });

    // 2. Idempotency: remove any prior same-named campaign.
    const removed = await cleanupOldCampaigns();

    // 3. Upload all carousel images → image_hashes (preserve order).
    const hashes = [];
    for (const u of carousel.image_urls) hashes.push(await uploadImage(u));

    // 4. Campaign (PAUSED). ABO — budget lives on the ad set.
    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: CAMPAIGN_NAME,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,   // ABO: independent ad-set budget
      status: 'PAUSED',
    });

    // 5. Ad set (PAUSED) — clone the proven profile-visit spec, our audience/budget.
    const adsetBody = {
      name: 'Sephora Collab — UAE+KSA Women 25-45',
      campaign_id: campaign.id,
      daily_budget: DAILY_BUDGET_CENTS,
      billing_event: refAdset.billing_event,
      bid_strategy: refAdset.bid_strategy,
      optimization_goal: refAdset.optimization_goal,   // VISIT_INSTAGRAM_PROFILE
      destination_type: refAdset.destination_type,     // INSTAGRAM_PROFILE
      targeting: buildTargeting(refAdset.targeting),
      status: 'PAUSED',
    };
    if (refAdset.promoted_object)  adsetBody.promoted_object  = refAdset.promoted_object;
    if (refAdset.attribution_spec) adsetBody.attribution_spec = refAdset.attribution_spec;
    const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, adsetBody);

    // 6. Carousel creative — multi-image child_attachments under @aastha_sochic.
    const linkData = {
      link: PROFILE_LINK,
      message: carousel.caption || 'Follow @aastha_sochic ✨',
      multi_share_optimized: false,   // keep her chosen card order
      multi_share_end_card: false,
      child_attachments: hashes.map((h) => ({ image_hash: h, link: PROFILE_LINK })),
    };
    if (refCreative.call_to_action_type) {
      linkData.call_to_action = { type: refCreative.call_to_action_type, value: { link: PROFILE_LINK } };
    }
    const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, {
      name: `Sephora carousel creative (${code})`,
      object_story_spec: { page_id: PAGE_ID, instagram_user_id: IG_USER_ID, link_data: linkData },
    });

    // 7. Ad (PAUSED).
    const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
      name: 'Sephora Collab — Carousel',
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    });

    // 8. Re-assert budget cap, then activate LAST (only if asked).
    await fbPost(`/${adset.id}`, { daily_budget: DAILY_BUDGET_CENTS });
    if (activate) {
      await fbPost(`/${campaign.id}`, { status: 'ACTIVE' });
      await fbPost(`/${adset.id}`,    { status: 'ACTIVE' });
      await fbPost(`/${ad.id}`,       { status: 'ACTIVE' });
    }

    return res.status(200).json({
      ok: true,
      status: activate ? 'launched-live' : 'built-paused',
      removed_prior: removed,
      campaign_id: campaign.id,
      adset_id: adset.id,
      creative_id: creative.id,
      ad_id: ad.id,
      cards: hashes.length,
      plan,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
