/**
 * Live profile grounding — single source of truth for Aastha's REAL numbers.
 *
 * Every pitch she might forward to a brand must quote numbers that match what
 * a brand sees if they check her actual Instagram insights. This module reads
 * the latest synced demographics + daily snapshot from Supabase so no pitch ever
 * ships a hardcoded/estimated stat again.
 *
 * IMPORTANT: instagram_demographics keeps multiple synced_at generations, so we
 * filter to the newest synced_at before aggregating — otherwise totals double-count.
 *
 * Returns null fields (never invented numbers) when a metric isn't stored yet.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

// Static facts that don't come from insights.
export const STATIC_PROFILE = {
  name: 'Aastha Chopra',
  handle: '@aastha_sochic',
  niches: 'lifestyle, fashion, beauty, fitness',
  // Confirmed 2026-08-31 from her own edit of a sent message — a real,
  // always-true fact the writer may cite, not something the per-brand
  // accuracy checker needs to verify.
  role: 'content creator and practicing corporate lawyer',
  whatsapp: '+97153646723',
  mediaPackUrl: 'https://www.aasthachopra.com/Aastha_Chopra_Media_Pack.pdf',
  website: 'https://www.aasthachopra.com',
  location: 'Dubai, UAE',
};

const UAE_CITY_PATTERNS = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain', 'Ras al-Khaimah', 'Fujairah'];

async function sbGet(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${await res.text()}`);
  return res.json();
}

/** Keep only rows from the most recent synced_at generation. */
function latestGeneration(rows) {
  if (!rows.length) return [];
  const newest = rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), rows[0].synced_at);
  return rows.filter((r) => r.synced_at === newest);
}

function cleanCity(dim) {
  return String(dim).split(',')[0].trim();
}

/**
 * @returns {Promise<{
 *   followers:number|null, uaeFollowers:number|null, uaePct:number|null,
 *   topCities:Array<{city:string,value:number}>, coreAge:string|null,
 *   uaeReach:number|null, asOf:string|null
 * }>}
 */
export async function getLiveProfile() {
  const out = {
    followers: null, uaeFollowers: null, uaePct: null,
    topCities: [], coreAge: null, uaeReach: null, asOf: null,
  };

  // 1. Total followers from the most recent daily snapshot.
  try {
    const snap = await sbGet('/instagram_snapshots?select=followers_count,snapshot_date&order=snapshot_date.desc&limit=1');
    out.followers = snap[0]?.followers_count ?? null;
    out.asOf = snap[0]?.snapshot_date ?? null;
  } catch { /* leave null */ }

  // 2. Follower demographics (latest generation only).
  try {
    const rows = latestGeneration(
      await sbGet('/instagram_demographics?metric=eq.follower_demographics&select=breakdown,dimension,value,synced_at&order=synced_at.desc&limit=2000')
    );

    const countries = rows.filter((r) => r.breakdown === 'country');
    const totalMeasured = countries.reduce((a, r) => a + (r.value || 0), 0);
    const uae = countries.find((r) => r.dimension === 'AE')?.value ?? null;
    out.uaeFollowers = uae;
    if (uae != null && totalMeasured > 0) out.uaePct = Math.round((uae / totalMeasured) * 1000) / 10;

    out.topCities = rows
      .filter((r) => r.breakdown === 'city' && UAE_CITY_PATTERNS.some((p) => String(r.dimension).includes(p)))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((r) => ({ city: cleanCity(r.dimension), value: r.value }));

    const ages = rows.filter((r) => r.breakdown === 'age').sort((a, b) => b.value - a.value);
    if (ages.length >= 2) {
      // Express the dominant band as an inclusive range across the top two.
      const bounds = ages.slice(0, 2).map((a) => a.dimension);
      const lows = bounds.map((b) => parseInt(b, 10)).sort((x, y) => x - y);
      const highs = bounds.map((b) => parseInt(String(b).split('-')[1] || b, 10)).sort((x, y) => x - y);
      out.coreAge = `${lows[0]}-${highs[highs.length - 1]}`;
    } else if (ages.length === 1) {
      out.coreAge = ages[0].dimension;
    }
  } catch { /* leave nulls */ }

  // 3. UAE reach — only present once ig-sync captures reached_audience_demographics.
  //    Never invented; stays null until the metric is actually stored.
  try {
    const reached = latestGeneration(
      await sbGet('/instagram_demographics?metric=eq.reached_audience_demographics&breakdown=eq.country&select=dimension,value,synced_at&order=synced_at.desc&limit=500')
    );
    const uaeReach = reached.find((r) => r.dimension === 'AE')?.value ?? null;
    if (uaeReach != null) out.uaeReach = uaeReach;
  } catch { /* leave null */ }

  return out;
}
