export const config = { maxDuration: 300 };

/**
 * Setup Audiences — one-shot manual endpoint (follower-growth warm targeting)
 *
 * North star = NET FOLLOWER GROWTH. Cold geo/interest traffic buys cheap profile
 * visits that don't convert to follows. Warm audiences convert far better, so:
 *
 *   1. ECA  — IG engagers of @aastha_sochic (365d). People who already interacted
 *             but may not follow yet → prime follow targets + the lookalike seed.
 *   2. LAL  — UAE lookalike of those engagers → NEW people similar to her fans,
 *             the actual NEW-follower engine.
 *   3. Campaign "Follower Growth — Warm Audiences" (PAUSED) with two ad sets that
 *      reuse the proven winning creatives:
 *        A. Lookalike  → Sephora carousel creative (brand social proof for cold-warm)
 *        B. Engagers   → Wellness reel creative (her stickiest hook)
 *      Both optimize VISIT_INSTAGRAM_PROFILE (cloned from the proven ref ad set).
 *
 * Why backend (not the meta-ads MCP): the MCP rejects ig_business engagement-rule
 * JSON and cannot create lookalikes at all. The production token can do both.
 *
 * Safety: everything PAUSED. ?dryrun=1 plans only. Idempotent by name.
 * GET /api/cron/setup-audiences[?dryrun=1]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

const FB_BASE = 'https://graph.facebook.com/v21.0';

const AD_ACCOUNT   = '1508208884141959';
const PAGE_ID      = '109895657605220';
const IG_USER_ID   = '17841400363033312';            // @aastha_sochic
const PROFILE_LINK = 'https://www.instagram.com/aastha_sochic/';

const REF_ADSET    = '120247276442590261';            // proven VISIT_INSTAGRAM_PROFILE spec
const REF_CAMPAIGN = '120247276440520261';

// Reuse already-built, proven creatives (no re-upload).
const SEPHORA_CREATIVE  = '1703113394065630';
const WELLNESS_CREATIVE = '1540836604104908';

const DAILY_BUDGET_CENTS = 1500;                      // 15 AED/day per ad set
const ECA_NAME = 'IG Engagers — @aastha_sochic (365d)';
const LAL_NAME = 'Lookalike — IG Engagers UAE 1%';
const CAMPAIGN_NAME = 'Follower Growth — Warm Audiences (Jun 2026)';

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

// Find an existing custom audience by exact name (idempotency / reuse).
async function findAudience(name) {
  const data = await fbGet(`/act_${AD_ACCOUNT}/customaudiences?fields=id,name,subtype,approximate_count_lower_bound&limit=200`);
  return (data.data || []).find((a) => a.name === name) || null;
}

async function cleanupOldCampaigns() {
  const data = await fbGet(`/act_${AD_ACCOUNT}/campaigns?fields=name&limit=200`);
  const mine = (data.data || []).filter((c) => c.name === CAMPAIGN_NAME);
  for (const c of mine) await fbDelete(`/${c.id}`).catch(() => {});
  return mine.map((c) => c.id);
}

function targetingFor(refTargeting, customAudienceId) {
  const t = refTargeting || {};
  const out = {
    geo_locations: { countries: ['AE'] },             // LAL is UAE-seeded; keep geo aligned
    genders: [2],
    age_min: 25,
    age_max: 45,
    custom_audiences: [{ id: customAudienceId }],
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
  if (!process.env.META_ADS_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });
  }

  const dryRun = req.query?.dryrun === '1';

  try {
    const [refAdset, refCampaign] = await Promise.all([
      fbGet(`/${REF_ADSET}?fields=optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,attribution_spec`),
      fbGet(`/${REF_CAMPAIGN}?fields=objective`),
    ]);

    if (dryRun) {
      return res.status(200).json({ ok: true, status: 'dry-run', plan: {
        will_create: [ECA_NAME, LAL_NAME, CAMPAIGN_NAME],
        adsets: ['A: Lookalike → Sephora carousel', 'B: Engagers → Wellness reel'],
        optimization_goal: refAdset.optimization_goal,
        budget: `${DAILY_BUDGET_CENTS / 100} AED/day × 2`,
      } });
    }

    // 1. ECA — IG engagers (reuse if it already exists).
    let eca = await findAudience(ECA_NAME);
    if (!eca) {
      eca = await fbPost(`/act_${AD_ACCOUNT}/customaudiences`, {
        name: ECA_NAME,
        description: 'IG engagers of @aastha_sochic, 365d — follower-growth warm pool + LAL seed',
        rule: JSON.stringify({
          inclusions: { operator: 'or', rules: [{
            event_sources: [{ type: 'ig_business', id: IG_USER_ID }],
            retention_seconds: 31536000,
            filter: { operator: 'and', filters: [
              { field: 'event', operator: 'eq', value: 'ig_business_profile_all' },
            ] },
          }] },
        }),
        prefill: true,
      });
    }

    // 2. LAL — UAE 1% lookalike of the engagers (reuse if exists).
    let lal = await findAudience(LAL_NAME);
    if (!lal) {
      lal = await fbPost(`/act_${AD_ACCOUNT}/customaudiences`, {
        name: LAL_NAME,
        subtype: 'LOOKALIKE',
        origin_audience_id: eca.id,
        lookalike_spec: JSON.stringify({ type: 'similarity', country: 'AE' }),
      });
    }

    // 3. Campaign (PAUSED, ABO) reusing winning creatives against warm audiences.
    await cleanupOldCampaigns();
    const campaign = await fbPost(`/act_${AD_ACCOUNT}/campaigns`, {
      name: CAMPAIGN_NAME,
      objective: refCampaign.objective || 'OUTCOME_TRAFFIC',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED',
    });

    const mkAdsetAd = async (label, audienceId, creativeId, adName) => {
      const body = {
        name: label,
        campaign_id: campaign.id,
        daily_budget: DAILY_BUDGET_CENTS,
        billing_event: refAdset.billing_event,
        bid_strategy: refAdset.bid_strategy,
        optimization_goal: refAdset.optimization_goal,
        destination_type: refAdset.destination_type,
        targeting: targetingFor(refAdset.targeting, audienceId),
        status: 'PAUSED',
      };
      if (refAdset.promoted_object)  body.promoted_object  = refAdset.promoted_object;
      if (refAdset.attribution_spec) body.attribution_spec = refAdset.attribution_spec;
      const adset = await fbPost(`/act_${AD_ACCOUNT}/adsets`, body);
      const ad = await fbPost(`/act_${AD_ACCOUNT}/ads`, {
        name: adName, adset_id: adset.id, creative: { creative_id: creativeId }, status: 'PAUSED',
      });
      return { label, adset_id: adset.id, ad_id: ad.id, audience_id: audienceId, creative_id: creativeId };
    };

    const adsets = [];
    adsets.push(await mkAdsetAd('Lookalike — IG Engagers UAE', lal.id, SEPHORA_CREATIVE, 'Sephora carousel → Lookalike'));
    adsets.push(await mkAdsetAd('Engagers — @aastha_sochic 365d', eca.id, WELLNESS_CREATIVE, 'Wellness reel → Engagers'));

    return res.status(200).json({
      ok: true, status: 'built-paused',
      eca: { id: eca.id, name: ECA_NAME },
      lal: { id: lal.id, name: LAL_NAME },
      campaign_id: campaign.id,
      adsets,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
