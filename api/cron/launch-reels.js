export const config = { maxDuration: 300 };

/**
 * Launch Reels — one-shot manual endpoint
 *
 * Promotes FOUR specific organic reels of @aastha_sochic as fresh VIDEO ads
 * (one ad set per reel) so we can learn which content theme — wellness /
 * fashion / beauty / luxury — wins for follower growth.
 *
 * Why this exists / how it differs from ad-autopilot.js:
 *   - The Marketing API cannot "boost" an existing IG post (UI-only), so we
 *     build fresh creatives from each reel's VIDEO file (autopilot does images).
 *   - We promote a CALLER-CHOSEN set of reels, not the Supabase auto-winner.
 *
 * Correctness by cloning: instead of hand-authoring the fragile
 * profile-visit ad-set + creative spec, we GET a known-good reference ad set
 * and reel creative (the proven "Reel — Hiking" A/B entities) and clone their
 * optimization_goal / billing_event / destination_type / promoted_object /
 * targeting / object_story_spec, swapping in the new video + thumbnail + caption
 * and the AE+SA · women · 25–45 audience.
 *
 * Safety:
 *   - Everything is created PAUSED. Activation happens LAST, only after all four
 *     ads are fully built. A failure mid-build therefore leaves nothing live and
 *     spends nothing — the half-built (paused) entities can be deleted.
 *   - Per-ad-set daily budget hard-asserted to 1000 cents (10 AED) → 40 AED/day.
 *   - ?dryrun=1 resolves reels + reference config and returns the plan WITHOUT
 *     creating anything.
 *   - ?activate=0 builds everything paused but does NOT flip live (review first).
 *
 * GET /api/cron/launch-reels[?dryrun=1][&activate=0]
 *   Auth: Bearer CRON_SECRET or MANUAL_SYNC_KEY
 */

import { getIgToken } from '../_igtoken.js';

const FB_BASE = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com/v21.0';

// Fixed assets (see project_meta_ads memory + ad-autopilot.js)
const AD_ACCOUNT = '1508208884141959';
const PAGE_ID    = '109895657605220';
const IG_USER_ID = '17841400363033312';

// Known-good references to CLONE (the proven reel profile-visit A/B entities).
const REF_ADSET    = '120247276442590261'; // "Reel — Hiking (VISIT_IG_PROFILE)"
const REF_CREATIVE = '2237800353684636';   // reel video creative
const REF_CAMPAIGN = '120247276440520261'; // "A/B Reel vs Carousel" (objective source)

const DAILY_BUDGET_CENTS = 1000; // 10 AED/day PER ad set (4 reels → 40 AED/day)

// The four reels to promote, in funnel order.
const REELS = [
  { code: 'DZmpjKdMkWb', theme: 'Wellness' },
  { code: 'DZNC5kbMvNd', theme: 'Fashion'  },
  { code: 'DGcufa-yTKL', theme: 'Beauty'   },
  { code: 'DU2pRgajMct', theme: 'Luxury'   },
];

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
  const data = await res.json().catch(() => ({}));
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAMPAIGN_NAME = 'Reels — Newer Work (UAE+KSA Women) Jun 2026';

// Delete any prior campaigns we created with this name — makes retries idempotent
// and clears the empty/paused orphans left by failed builds. Only ever touches
// campaigns matching our exact generated name, so it can't hit unrelated ads.
async function cleanupOldCampaigns() {
  const data = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name,status&limit=200`);
  const mine = (data.data || []).filter((c) => c.name === CAMPAIGN_NAME);
  for (const c of mine) await fbDelete(`/${c.id}`).catch(() => {});
  return mine.map((c) => c.id);
}

// ── Step 1: resolve each reel shortcode → { media_url, thumbnail_url, caption } ─
async function resolveReels() {
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

  const byCode = {};
  for (const m of media) {
    const match = (m.permalink || '').match(/\/(?:reel|p|tv)\/([^/]+)\//);
    if (match) byCode[match[1]] = m;
  }

  return REELS.map((r) => {
    const m = byCode[r.code];
    if (!m) throw new Error(`Reel ${r.code} (${r.theme}) not found in last 500 media`);
    if (m.media_type !== 'VIDEO') throw new Error(`Reel ${r.code} is ${m.media_type}, not VIDEO`);
    if (!m.media_url) throw new Error(`Reel ${r.code} has no media_url`);
    return {
      ...r,
      media_id: m.id,
      media_url: m.media_url,
      thumbnail_url: m.thumbnail_url || null,
      caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      permalink: m.permalink,
    };
  });
}

// ── Build a clean, writable targeting object from the reference ad set ─────────
function buildTargeting(refTargeting) {
  const t = refTargeting || {};
  const out = {
    geo_locations: { countries: ['AE', 'SA'] }, // UAE + KSA
    genders: [2],                               // women
    age_min: 25,
    age_max: 45,
    targeting_automation: { advantage_audience: 0 }, // respect the defined audience
  };
  // Preserve placement config from the proven reel ad set so Reels delivery is kept.
  for (const k of [
    'publisher_platforms', 'facebook_positions', 'instagram_positions',
    'device_platforms', 'threads_positions',
  ]) {
    if (Array.isArray(t[k]) && t[k].length) out[k] = t[k];
  }
  return out;
}

// ── Upload reel video by URL, poll until Meta finishes processing ─────────────
async function uploadVideo(reel) {
  const up = await fbPost(`/act_${AD_ACCOUNT}/advideos`, {
    file_url: reel.media_url,
    name: `Reel — ${reel.theme} (${reel.code})`,
  });
  const videoId = up.id;
  if (!videoId) throw new Error(`${reel.theme}: advideos returned no id`);

  // Poll status (reels are short; usually ready within ~30s).
  for (let i = 0; i < 40; i++) {
    const s = await fbGet(`/${videoId}?fields=status`);
    const vs = s.status?.video_status;
    if (vs === 'ready') return videoId;
    if (vs === 'error') throw new Error(`${reel.theme}: video processing error`);
    await sleep(4000);
  }
  throw new Error(`${reel.theme}: video not ready after ~160s`);
}

// ── Upload the reel thumbnail → image_hash (video_data needs a cover image) ────
async function uploadThumb(reel) {
  if (!reel.thumbnail_url) return null;
  const r = await fetch(reel.thumbnail_url);
  if (!r.ok) return null;
  const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
  const uploaded = await fbPost(`/act_${AD_ACCOUNT}/adimages`, { bytes: b64 });
  return Object.values(uploaded.images || {})[0]?.hash || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const ok = auth === `Bearer ${process.env.CRON_SECRET}` ||
             (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!ok) return res.status(401).end();

  if (!process.env.META_ADS_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });
  }

  const dryRun   = req.query?.dryrun === '1';
  const activate = req.query?.activate !== '0';      // default: go live
  // identity=page → publish as the Facebook Page (no IG account needed), traffic
  // to her IG profile via the CTA link. Default 'ig' = true IG profile-visit ads
  // (requires @aastha_sochic assigned to the ad account).
  const pageIdentity = req.query?.identity === 'page';

  try {
    if (req.query?.cleanuponly === '1') {
      const deleted = await cleanupOldCampaigns();
      return res.status(200).json({ ok: true, status: 'cleaned', deleted });
    }

    // Raise (or change) age_max on every ad set of our campaign, preserving the
    // rest of each ad set's targeting. e.g. ?setagemax=55
    if (req.query?.setagemax) {
      const ageMax = parseInt(req.query.setagemax, 10);
      const camps = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name&limit=200`);
      const camp = (camps.data || []).find((c) => c.name === CAMPAIGN_NAME);
      if (!camp) return res.status(404).json({ error: 'Campaign not found' });
      const adsets = await fbGet(`/${camp.id}/adsets?fields=id,name,targeting&limit=50`);
      const updated = [];
      for (const a of adsets.data || []) {
        const t = a.targeting || {};
        t.age_max = ageMax;
        await fbPost(`/${a.id}`, { targeting: t });
        updated.push({ id: a.id, name: a.name, age_min: t.age_min, age_max: t.age_max });
      }
      return res.status(200).json({ ok: true, status: 'age-updated', updated });
    }

    // 1. Resolve reels + pull reference config (parallel).
    const [reels, refAdset, refCreative, refCampaign] = await Promise.all([
      resolveReels(),
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,bid_amount,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CREATIVE}?fields=object_story_spec,call_to_action_type`),
      fbGet(`/${REF_CAMPAIGN}?fields=objective,special_ad_categories,buying_type`),
    ]);

    // Diagnostic: surface the IG identities this Page / ad account can publish as.
    if (req.query?.diag === '1') {
      const safe = (p) => fbGet(p).catch((e) => ({ error: e.message }));
      const tok = process.env.META_ADS_ACCESS_TOKEN;
      const [pageIg, acctIg, acctIg2, dbg, me] = await Promise.all([
        safe(`/${PAGE_ID}?fields=name,instagram_business_account{id,username},connected_instagram_account{id,username},page_backed_instagram_accounts{id,username}`),
        safe(`/act_${AD_ACCOUNT}/instagram_accounts?fields=id,username`),
        safe(`/act_${AD_ACCOUNT}/?fields=instagram_accounts{id,username}`),
        safe(`/debug_token?input_token=${tok}`),
        safe(`/me?fields=id,name`),
      ]);
      return res.status(200).json({
        ok: true, status: 'diag',
        token: dbg, me,
        ref_creative_story_spec: refCreative.object_story_spec,
        page_ig: pageIg, account_ig_edge: acctIg, account_ig_field: acctIg2,
      });
    }

    const plan = {
      reels: reels.map((r) => ({ theme: r.theme, code: r.code, permalink: r.permalink, media_id: r.media_id })),
      reference: {
        objective: refCampaign.objective,
        optimization_goal: refAdset.optimization_goal,
        destination_type: refAdset.destination_type,
        billing_event: refAdset.billing_event,
        bid_strategy: refAdset.bid_strategy,
      },
      budget: `${DAILY_BUDGET_CENTS / 100} AED/day × ${reels.length} ad sets = ${(DAILY_BUDGET_CENTS / 100) * reels.length} AED/day`,
      activate,
    };

    if (dryRun) {
      return res.status(200).json({ ok: true, status: 'dry-run', plan });
    }

    // 2. Idempotency: remove any prior campaign we created with this name.
    const removed = await cleanupOldCampaigns();

    // 3. Create the parent campaign (PAUSED). ABO — budget lives on each ad set.
    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: CAMPAIGN_NAME,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false, // independent per-reel budgets (clean A/B)
      status: 'PAUSED',
    });

    const targeting = buildTargeting(refAdset.targeting);

    // 3. Per reel: upload video + thumb, create ad set + creative + ad (all PAUSED).
    const built = await Promise.all(reels.map(async (reel) => {
      const [videoId, imageHash] = await Promise.all([uploadVideo(reel), uploadThumb(reel)]);

      const adsetBody = {
        name: `Reel — ${reel.theme} (UAE+KSA Women)`,
        campaign_id: campaign.id,
        daily_budget: DAILY_BUDGET_CENTS,
        billing_event: refAdset.billing_event,
        bid_strategy: refAdset.bid_strategy,
        targeting,
        status: 'PAUSED',
      };
      if (pageIdentity) {
        // No IG account on the ad account → optimize for link clicks to her IG.
        adsetBody.optimization_goal = 'LINK_CLICKS';
      } else {
        adsetBody.optimization_goal = refAdset.optimization_goal;   // VISIT_INSTAGRAM_PROFILE
        adsetBody.destination_type  = refAdset.destination_type;    // INSTAGRAM_PROFILE
        adsetBody.promoted_object   = refAdset.promoted_object;
      }
      if (refAdset.attribution_spec) adsetBody.attribution_spec = refAdset.attribution_spec;
      const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, adsetBody);

      // Clone the reference creative's story spec, swap in this reel's media.
      // Keep the reference's page_id / Instagram linkage exactly as-is — it's the
      // identity this ad account is actually authorized to publish as (the
      // hardcoded IG_USER_ID belongs to the other portfolio and is rejected).
      const oss = JSON.parse(JSON.stringify(refCreative.object_story_spec || {}));
      // Page-identity fallback: drop the IG actor so the creative publishes as the
      // Facebook Page (the CTA still links to her IG profile).
      if (pageIdentity) { delete oss.instagram_user_id; delete oss.instagram_actor_id; }
      oss.video_data = oss.video_data || {};
      oss.video_data.video_id = videoId;
      if (imageHash) {
        oss.video_data.image_hash = imageHash;
        delete oss.video_data.image_url;
      }
      oss.video_data.message = reel.caption || 'Follow @aastha_sochic ✨';

      const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, {
        name: `Reel creative — ${reel.theme} (${reel.code})`,
        object_story_spec: oss,
      });

      const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
        name: `Reel — ${reel.theme}`,
        adset_id: adset.id,
        creative: { creative_id: creative.id },
        status: 'PAUSED',
      });

      return { theme: reel.theme, code: reel.code, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id, video_id: videoId };
    }));

    // 4. Re-assert the budget cap on every ad set before going live.
    await Promise.all(built.map((b) => fbPost(`/${b.adset_id}`, { daily_budget: DAILY_BUDGET_CENTS })));

    // 5. Activate LAST (campaign → ad sets → ads). Nothing spent until here.
    if (activate) {
      await fbPost(`/${campaign.id}`, { status: 'ACTIVE' });
      await Promise.all(built.map((b) => fbPost(`/${b.adset_id}`, { status: 'ACTIVE' })));
      await Promise.all(built.map((b) => fbPost(`/${b.ad_id}`, { status: 'ACTIVE' })));
    }

    return res.status(200).json({
      ok: true,
      status: activate ? 'launched-live' : 'built-paused',
      campaign_id: campaign.id,
      ads: built,
      plan,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
