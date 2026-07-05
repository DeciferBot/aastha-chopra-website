export const config = { maxDuration: 300 };

/**
 * Launch Reels — one-shot manual endpoint
 *
 * Promotes FOUR specific organic reels of @aastha_sochic as ads (one ad set per
 * reel) so we can learn which content theme — wellness / fashion / beauty /
 * luxury — wins for follower growth.
 *
 * Engagement stays on the REAL post:
 *   Each ad promotes the EXISTING Instagram reel by id (object_id +
 *   instagram_user_id + source_instagram_media_id) instead of re-uploading its
 *   video. So every paid like/comment/view consolidates onto the actual post as
 *   social proof — it does NOT bleed into a throwaway "dark post". The shared
 *   mechanism (and the id-namespace trap it guards) lives in ../_igpromote.js.
 *
 * Correctness by cloning: instead of hand-authoring the fragile profile-visit
 * ad-set spec, we GET a known-good reference ad set (the proven "Reel — Hiking"
 * A/B entity) and clone its optimization_goal / billing_event / destination_type
 * / promoted_object / targeting, swapping in the AE+SA · women · 25–45 audience.
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

import {
  resolveIgUserId,
  fetchIgMediaMap,
  existingPostCreativeBody,
} from '../_igpromote.js';

const FB_BASE = 'https://graph.facebook.com/v21.0';

// Fixed assets (see project_meta_ads + project_meta_business_portfolios memory)
const AD_ACCOUNT     = '1508208884141959';
const PAGE_ID        = '109895657605220';
const IG_USER_FALLBACK = '17841400363033312'; // @aastha_sochic, if the Page lookup is empty

// Known-good reference to CLONE (the proven reel profile-visit A/B ad set).
const REF_ADSET    = '120247276442590261'; // "Reel — Hiking (VISIT_IG_PROFILE)"
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

// ── Resolve each reel shortcode → its real IG media (correct id namespace) ─────
async function resolveReels(igUserId) {
  const { byCode } = await fetchIgMediaMap(igUserId);
  return REELS.map((r) => {
    const m = byCode[r.code];
    if (!m) throw new Error(`Reel ${r.code} (${r.theme}) not found in the IG account's latest 500 media`);
    return {
      ...r,
      media_id: m.id,
      media_type: m.media_type,
      permalink: m.permalink,
      caption: (m.caption || '').replace(/\s+/g, ' ').trim().slice(0, 120),
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

    // Resolve the IG identity we publish as + own the media.
    const igUserId = await resolveIgUserId(PAGE_ID, IG_USER_FALLBACK);

    // Diagnostic: surface the resolved IG identity + the reels we'd promote.
    if (req.query?.diag === '1') {
      const { list } = await fetchIgMediaMap(igUserId, 100);
      return res.status(200).json({
        ok: true, status: 'diag',
        ig_user_id: igUserId,
        sample_media: list.slice(0, 5).map((m) => ({ id: m.id, type: m.media_type, permalink: m.permalink })),
      });
    }

    // Resolve reels + pull reference config (parallel).
    const [reels, refAdset, refCampaign] = await Promise.all([
      resolveReels(igUserId),
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,bid_amount,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CAMPAIGN}?fields=objective,special_ad_categories,buying_type`),
    ]);

    const plan = {
      ig_user_id: igUserId,
      reels: reels.map((r) => ({ theme: r.theme, code: r.code, permalink: r.permalink, media_id: r.media_id, media_type: r.media_type })),
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

    // Idempotency: remove any prior campaign we created with this name.
    const removed = await cleanupOldCampaigns();

    // Create the parent campaign (PAUSED). ABO — budget lives on each ad set.
    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: CAMPAIGN_NAME,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false, // independent per-reel budgets (clean A/B)
      status: 'PAUSED',
    });

    const targeting = buildTargeting(refAdset.targeting);

    // Per reel: create ad set + existing-post creative + ad (all PAUSED).
    // Build each reel independently. A reel Meta refuses to boost (most commonly
    // copyrighted/trending music, subcode 2875030) is SKIPPED — we roll back its
    // half-built paused ad set and keep going, so one bad reel can't sink the
    // whole batch. Every skip is reported, never silently dropped.
    const results = await Promise.all(reels.map(async (reel) => {
      let adsetId = null;
      try {
        const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, {
          name: `Reel — ${reel.theme} (UAE+KSA Women)`,
          campaign_id: campaign.id,
          daily_budget: DAILY_BUDGET_CENTS,
          billing_event: refAdset.billing_event,
          bid_strategy: refAdset.bid_strategy,
          optimization_goal: refAdset.optimization_goal, // VISIT_INSTAGRAM_PROFILE
          destination_type: refAdset.destination_type,   // INSTAGRAM_PROFILE
          ...(refAdset.promoted_object  ? { promoted_object:  refAdset.promoted_object }  : {}),
          ...(refAdset.attribution_spec ? { attribution_spec: refAdset.attribution_spec } : {}),
          targeting,
          status: 'PAUSED',
        });
        adsetId = adset.id;

        // Promote the EXISTING reel — engagement lands on the real post.
        const creative = await fbPost(`/act_${AD_ACCOUNT}/adcreatives`, existingPostCreativeBody({
          name: `Reel promo — ${reel.theme} (${reel.code})`,
          pageId: PAGE_ID,
          igUserId,
          mediaId: reel.media_id,
        }));

        const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
          name: `Reel — ${reel.theme}`,
          adset_id: adset.id,
          creative: { creative_id: creative.id },
          status: 'PAUSED',
        });

        return { ok: true, theme: reel.theme, code: reel.code, permalink: reel.permalink, adset_id: adset.id, creative_id: creative.id, ad_id: ad.id, media_id: reel.media_id };
      } catch (e) {
        // Roll back this reel's orphaned paused ad set so nothing lingers.
        if (adsetId) await fbDelete(`/${adsetId}`).catch(() => {});
        return { ok: false, theme: reel.theme, code: reel.code, permalink: reel.permalink, reason: e.message };
      }
    }));

    const built   = results.filter((r) => r.ok);
    const skipped = results.filter((r) => !r.ok)
      .map((r) => ({ theme: r.theme, code: r.code, permalink: r.permalink, reason: r.reason }));

    // Nothing survived — tear down the empty campaign and report why.
    if (built.length === 0) {
      await fbDelete(`/${campaign.id}`).catch(() => {});
      return res.status(200).json({ ok: false, status: 'all-skipped', skipped, plan });
    }

    // Re-assert the budget cap on every built ad set before going live.
    await Promise.all(built.map((b) => fbPost(`/${b.adset_id}`, { daily_budget: DAILY_BUDGET_CENTS })));

    // Activate LAST (campaign → ad sets → ads). Nothing spent until here.
    if (activate) {
      await fbPost(`/${campaign.id}`, { status: 'ACTIVE' });
      await Promise.all(built.map((b) => fbPost(`/${b.adset_id}`, { status: 'ACTIVE' })));
      await Promise.all(built.map((b) => fbPost(`/${b.ad_id}`, { status: 'ACTIVE' })));
    }

    return res.status(200).json({
      ok: true,
      status: activate ? 'launched-live' : 'built-paused',
      campaign_id: campaign.id,
      built: built.length,
      skipped_count: skipped.length,
      ads: built,
      skipped,
      plan,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
