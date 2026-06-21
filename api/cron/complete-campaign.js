export const config = { maxDuration: 60 };

/**
 * Complete Campaign — archive a finished campaign's data, then close it.
 *
 * When a campaign is done, snapshot its LIFETIME performance into Supabase
 * `completed_campaigns` (so the learning survives), then pause it. After this,
 * the campaign can be safely deleted in Ads Manager without losing history.
 *
 * GET /api/cron/complete-campaign?campaign_id=ID[&theme=wellness][&note=...][&close=1][&dryrun=1]
 *   close=1 → pause the campaign + its ad sets after archiving (default: archive only)
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY | LAUNCH_KEY
 */

const FB_BASE      = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT   = '1508208884141959';
const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

function ymd(d) { return d.toISOString().slice(0, 10); }

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

async function sbGet(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: HTTP ${res.status}`);
  return res.json();
}

async function sbUpsert(row) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/completed_campaigns?on_conflict=campaign_id`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase upsert: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Profile visits out of an insights actions[] array.
function visitsFrom(actions = []) {
  const m = {};
  for (const a of actions) m[a.action_type] = Number(a.value);
  return m['onsite_conversion.ig_profile_visit'] ?? m['onsite_conversion.ig_profile_engagement'] ?? m['link_click'] ?? 0;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.MANUAL_SYNC_KEY]
    .filter(Boolean).some((k) => auth === `Bearer ${k}`);
  if (!ok) return res.status(401).end();
  if (!process.env.META_ADS_ACCESS_TOKEN) return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });

  const campaignId = req.query?.campaign_id;
  if (!campaignId) return res.status(400).json({ error: 'Missing ?campaign_id=ID' });
  const theme  = req.query?.theme || null;
  const note   = req.query?.note || null;
  const close  = req.query?.close === '1';
  const dryRun = req.query?.dryrun === '1';

  try {
    const [meta, camp, adsetIns] = await Promise.all([
      fbGet(`/${campaignId}?fields=name,objective,created_time,effective_status`),
      fbGet(`/${campaignId}/insights?date_preset=maximum&fields=spend,reach,impressions,ctr,actions`),
      fbGet(`/${campaignId}/insights?level=adset&date_preset=maximum&fields=adset_name,spend,reach,actions`),
    ]);

    const c = (camp.data || [])[0] || {};
    const spend  = Number(c.spend || 0);
    const visits = visitsFrom(c.actions);
    const startedAt = (meta.created_time || '').slice(0, 10) || null;

    const adsets = (adsetIns.data || []).map((a) => {
      const s = Number(a.spend || 0), v = visitsFrom(a.actions);
      return { name: a.adset_name, spend: Number(s.toFixed(2)), reach: Number(a.reach || 0),
               profile_visits: v, cost_per_visit: v ? Number((s / v).toFixed(3)) : null };
    });

    // Follower context: account followers at campaign start vs now.
    let followersStart = null, followersEnd = null;
    if (startedAt) {
      const [s0, s1] = await Promise.all([
        sbGet(`/instagram_snapshots?snapshot_date=gte.${startedAt}&select=followers_count&order=snapshot_date.asc&limit=1`),
        sbGet(`/instagram_snapshots?select=followers_count&order=snapshot_date.desc&limit=1`),
      ]);
      followersStart = s0[0]?.followers_count ?? null;
      followersEnd   = s1[0]?.followers_count ?? null;
    }

    const record = {
      campaign_id: campaignId,
      name: meta.name,
      objective: meta.objective,
      theme,
      started_at: startedAt,
      closed_at: ymd(new Date()),
      spend_aed: Number(spend.toFixed(2)),
      reach: Number(c.reach || 0),
      impressions: Number(c.impressions || 0),
      profile_visits: visits,
      cost_per_visit: visits ? Number((spend / visits).toFixed(4)) : null,
      ctr: c.ctr != null ? Number(Number(c.ctr).toFixed(3)) : null,
      followers_start: followersStart,
      followers_end: followersEnd,
      adsets,
      note,
    };

    if (dryRun) return res.status(200).json({ ok: true, status: 'dry-run', record });

    const [stored] = await sbUpsert(record);

    let closed = false;
    if (close) {
      const sets = await fbGet(`/${campaignId}/adsets?fields=id&limit=100`);
      await Promise.all((sets.data || []).map((s) => fbPost(`/${s.id}`, { status: 'PAUSED' }).catch(() => {})));
      await fbPost(`/${campaignId}`, { status: 'PAUSED' });
      closed = true;
    }

    return res.status(200).json({ ok: true, status: closed ? 'archived-and-closed' : 'archived', closed, record: stored });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
