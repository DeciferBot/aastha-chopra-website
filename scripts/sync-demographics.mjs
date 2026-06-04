/**
 * Instagram Demographics & Account Metrics → Supabase
 * -------------------------------------------------------
 * Pulls ALL available demographic breakdowns and daily account
 * metrics, stores in Supabase. Run daily via cron.
 *
 * Usage:
 *   node scripts/sync-demographics.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '../.env.local');
const env = {};
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}

const IG_TOKEN    = env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID  = env.INSTAGRAM_USER_ID      || process.env.INSTAGRAM_USER_ID;
const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxenZheXR2eW5yZ2xpanZ3anN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU1MTUzMywiZXhwIjoyMDk2MTI3NTMzfQ.oDkOn85Ibdd2zhplNh_ocKecaTu5qoehQ-Ht3KlKhxA';

const BASE = `https://graph.instagram.com/v21.0/${IG_USER_ID}/insights`;
const synced_at = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────
async function igGet(metric, extra = '') {
  const url = `${BASE}?metric=${metric}&period=lifetime&metric_type=total_value&access_token=${IG_TOKEN}${extra}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    if (data.error.code === 3006) return null; // "Not enough users" — skip silently
    throw new Error(`IG: ${data.error.message}`);
  }
  return data.data?.[0]?.total_value?.breakdowns?.[0]?.results || null;
}

async function igGetPeriod(metric, period) {
  const url = `${BASE}?metric=${metric}&period=${period}&access_token=${IG_TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || !data.data?.length) return null;
  return data.data[0].values || null;
}

async function upsertRows(rows) {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_demographics?on_conflict=synced_at,metric,breakdown,dimension`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) throw new Error(`DB insert failed: ${await res.text()}`);
}

async function upsertDailyMetrics(row) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_daily_metrics?on_conflict=metric_date`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) throw new Error(`Daily metrics insert failed: ${await res.text()}`);
}

function toRows(results, metric, breakdown) {
  if (!results) return [];
  // Aggregate duplicates (API sometimes returns same dimension multiple times)
  const agg = {};
  for (const r of results) {
    const dim = r.dimension_values[0];
    agg[dim] = (agg[dim] || 0) + r.value;
  }
  return Object.entries(agg).map(([dimension, value]) => ({
    synced_at,
    metric,
    breakdown,
    dimension,
    value,
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!IG_TOKEN) { console.error('❌  INSTAGRAM_ACCESS_TOKEN not set'); process.exit(1); }

  console.log('🌍  Syncing Instagram demographics & metrics');
  console.log(`    Account: ${IG_USER_ID}\n`);

  // ── 1. Follower Demographics (who follows her) ──────────────────────────────
  console.log('👥  Follower demographics...');

  const [
    followerAge,
    followerGender,
    followerCountry,
    followerCity,
  ] = await Promise.all([
    igGet('follower_demographics', '&breakdown=age'),
    igGet('follower_demographics', '&breakdown=gender'),
    igGet('follower_demographics', '&breakdown=country'),
    igGet('follower_demographics', '&breakdown=city'),
  ]);

  const followerRows = [
    ...toRows(followerAge,     'follower_demographics', 'age'),
    ...toRows(followerGender,  'follower_demographics', 'gender'),
    ...toRows(followerCountry, 'follower_demographics', 'country'),
    ...toRows(followerCity,    'follower_demographics', 'city'),
  ];
  await upsertRows(followerRows);
  console.log(`    ✅  ${followerRows.length} follower demographic rows saved`);
  console.log(`        Age buckets: ${followerAge?.length || 0}`);
  console.log(`        Genders:     ${followerGender?.length || 0}`);
  console.log(`        Countries:   ${followerCountry?.length || 0}`);
  console.log(`        Cities:      ${followerCity?.length || 0}`);

  // ── 2. Reached Audience Demographics (who saw her content) ──────────────────
  console.log('\n📡  Reached audience demographics...');

  const [
    reachedAge,
    reachedGender,
    reachedCountry,
    reachedCity,
  ] = await Promise.all([
    igGet('reached_audience_demographics', '&breakdown=age'),
    igGet('reached_audience_demographics', '&breakdown=gender'),
    igGet('reached_audience_demographics', '&breakdown=country'),
    igGet('reached_audience_demographics', '&breakdown=city'),
  ]);

  const reachedRows = [
    ...toRows(reachedAge,     'reached_audience_demographics', 'age'),
    ...toRows(reachedGender,  'reached_audience_demographics', 'gender'),
    ...toRows(reachedCountry, 'reached_audience_demographics', 'country'),
    ...toRows(reachedCity,    'reached_audience_demographics', 'city'),
  ];
  await upsertRows(reachedRows);
  console.log(`    ✅  ${reachedRows.length} reached demographic rows saved`);

  // ── 3. Engaged Audience Demographics (who interacted) ──────────────────────
  console.log('\n💬  Engaged audience demographics...');

  const [
    engagedAge,
    engagedGender,
    engagedCountry,
    engagedCity,
  ] = await Promise.all([
    igGet('engaged_audience_demographics', '&breakdown=age'),
    igGet('engaged_audience_demographics', '&breakdown=gender'),
    igGet('engaged_audience_demographics', '&breakdown=country'),
    igGet('engaged_audience_demographics', '&breakdown=city'),
  ]);

  const engagedRows = [
    ...toRows(engagedAge,     'engaged_audience_demographics', 'age'),
    ...toRows(engagedGender,  'engaged_audience_demographics', 'gender'),
    ...toRows(engagedCountry, 'engaged_audience_demographics', 'country'),
    ...toRows(engagedCity,    'engaged_audience_demographics', 'city'),
  ];
  await upsertRows(engagedRows);
  console.log(`    ✅  ${engagedRows.length} engaged demographic rows saved`);

  // ── 4. Daily Account Metrics ────────────────────────────────────────────────
  console.log('\n📊  Daily account metrics...');

  const today = new Date().toISOString().slice(0, 10);
  const dailyRow = { metric_date: today };

  // Reach (day)
  const reachValues = await igGetPeriod('reach,follower_count', 'day');
  // follows_and_unfollows (week)
  const followValues = await igGetPeriod('follows_and_unfollows', 'week');

  // Flatten reach data
  const reachUrl = `${BASE}?metric=reach,follower_count&period=day&access_token=${IG_TOKEN}`;
  const reachRes = await fetch(reachUrl);
  const reachData = await reachRes.json();
  if (reachData.data) {
    reachData.data.forEach(m => {
      const latest = m.values?.[m.values.length - 1]?.value;
      if (m.name === 'reach')          dailyRow.reach          = latest;
      if (m.name === 'follower_count') dailyRow.follower_count = latest;
    });
  }

  // follows_and_unfollows
  if (followValues) {
    const latest = followValues[followValues.length - 1]?.value;
    if (typeof latest === 'object') {
      dailyRow.follows   = latest.follows   || 0;
      dailyRow.unfollows = latest.unfollows || 0;
    }
  }

  // Account snapshot (follower count)
  const accountRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_USER_ID}?fields=followers_count,media_count&access_token=${IG_TOKEN}`
  );
  const account = await accountRes.json();
  if (account.followers_count) dailyRow.follower_count = account.followers_count;

  await upsertDailyMetrics(dailyRow);
  console.log(`    ✅  Daily metrics saved for ${today}`);
  console.log(`        Reach: ${dailyRow.reach || 0} | Followers: ${dailyRow.follower_count || 0}`);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const totalRows = followerRows.length + reachedRows.length + engagedRows.length;
  console.log('\n─────────────────────────────────────');
  console.log(`✅  Done — ${totalRows} demographic data points stored`);
  console.log(`    Follower audience:  ${followerRows.length} rows`);
  console.log(`    Reached audience:   ${reachedRows.length} rows`);
  console.log(`    Engaged audience:   ${engagedRows.length} rows`);
  console.log('─────────────────────────────────────');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
