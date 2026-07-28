import { getIgToken } from '../_igtoken.js';

export const config = { maxDuration: 300 };

/**
 * Instagram Incremental Sync — Vercel Cron
 * Runs every 4 hours. Bounded work per run so runtime stays ~constant as the
 * post catalogue grows (no more full-catalogue sweep that creeps toward the 300s
 * function limit):
 *   - Newest RECENT_LIMIT posts: metadata + insights + carousel children (always
 *     captures brand-new posts and keeps recent insights fresh every run)
 *   - Rolling ROLL_LIMIT older posts: insights-only refresh, ordered by stalest
 *     insights_synced_at first, so the whole catalogue cycles through over a few
 *     days without ever re-syncing everything at once
 *   - Follower + reached demographics (age, gender, city, country)
 *   - Daily account snapshot (followers, reach, profile views, website clicks)
 *
 * GET /api/cron/ig-sync
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const IG_BASE = 'https://graph.instagram.com/v21.0';

// Bounded work per run. RECENT_LIMIT newest posts are fully synced (metadata +
// insights); ROLL_LIMIT older posts get an insights-only refresh on rotation.
const RECENT_LIMIT = 150;
const ROLL_LIMIT = 150;

// Insight columns we read back for the rolling refresh, so a failed/empty insight
// fetch preserves the existing values instead of nulling them out.
const INSIGHT_COLS = [
  'id', 'media_type', 'reach', 'likes', 'comments', 'shares', 'saved',
  'total_interactions', 'views', 'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
].join(',');

const MEDIA_FIELDS = [
  'id', 'media_type', 'caption', 'permalink', 'timestamp',
  'like_count', 'comments_count', 'is_shared_to_feed',
  'media_url', 'thumbnail_url',
].join(',');

// Per media type — IMAGE and CAROUSEL_ALBUM share the same set
const METRICS = {
  IMAGE:          'reach,saved,likes,comments,shares,total_interactions',
  CAROUSEL_ALBUM: 'reach,saved,likes,comments,shares,total_interactions',
  VIDEO:          'reach,saved,likes,comments,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,views',
};

// Demographics breakdowns supported by the API
const DEMO_BREAKDOWNS = ['age', 'gender', 'city', 'country'];

async function ig(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${IG_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`IG API error on ${path}: ${data.error.message}`);
  return data;
}

async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${opts.method || 'GET'} ${path}: ${body}`);
  }
  // Only parse JSON when there's a body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Pause between batches to stay well under rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1. Fetch the newest media (bounded pagination, newest-first) ───────────────
async function fetchRecentMedia(token, limit) {
  const all = [];
  const seen = new Set();
  let after = null;

  while (all.length < limit) {
    const qs = after
      ? `/me/media?fields=${MEDIA_FIELDS}&limit=50&after=${after}`
      : `/me/media?fields=${MEDIA_FIELDS}&limit=50`;
    const data = await ig(qs, token);
    const page = data.data || [];
    if (!page.length) break;

    all.push(...page);

    // Stop at the last page or if the cursor repeats (loop guard)
    const cursor = data.paging?.cursors?.after;
    if (!cursor || seen.has(cursor) || !data.paging?.next) break;
    seen.add(cursor);
    after = cursor;
  }
  return all.slice(0, limit);
}

// ── 1b. Pull the posts whose insights are stalest, for a rolling refresh ───────
// Ordered oldest-insights-first (NULLS FIRST), so over successive runs the whole
// catalogue cycles through. Insight columns come back too, so an empty/failed
// insight fetch can fall back to the stored value rather than nulling it.
async function fetchStaleInsightPosts(limit) {
  const rows = await sb(
    `/instagram_posts?select=${INSIGHT_COLS}&order=insights_synced_at.asc.nullsfirst&limit=${limit}`
  );
  return rows || [];
}

// ── 2. Fetch insights for one post ───────────────────────────────────────────
async function fetchInsights(postId, mediaType, token) {
  const metrics = METRICS[mediaType] || METRICS.IMAGE;
  try {
    const data = await ig(`/${postId}/insights?metric=${metrics}&period=lifetime`, token);
    const flat = {};
    (data.data || []).forEach(m => {
      flat[m.name] = m.values?.[0]?.value ?? m.value ?? null;
    });
    return flat;
  } catch {
    // Some old posts may not have insights — skip silently
    return {};
  }
}

// ── 3. Fetch carousel children ────────────────────────────────────────────────
async function fetchCarouselChildren(postId, token) {
  try {
    const data = await ig(`/${postId}/children?fields=id,media_type,media_url,thumbnail_url`, token);
    return data.data || [];
  } catch {
    return [];
  }
}

// ── 4. Fetch demographics ─────────────────────────────────────────────────────
async function fetchDemographics(token) {
  const rows = [];
  const now = new Date().toISOString();

  for (const breakdown of DEMO_BREAKDOWNS) {
    try {
      const data = await ig(
        `/me/insights?metric=follower_demographics&period=lifetime&breakdown=${breakdown}&metric_type=total_value`,
        token
      );
      const metric = data.data?.[0];
      if (!metric) continue;
      const breakdownData = metric.total_value?.breakdowns?.[0]?.results || [];
      breakdownData.forEach(item => {
        rows.push({
          synced_at: now,
          metric: 'follower_demographics',
          breakdown,
          dimension: item.dimension_values?.[0] ?? item.dimension_value ?? String(item.value),
          value: item.value,
        });
      });
      await sleep(300);
    } catch {
      // Demographics require manage_insights permission — skip if missing
    }
  }
  return rows;
}

// ── 4b. Fetch reached-audience demographics (powers honest UAE *reach* stats) ──
// follower_demographics tells us who follows her; reached_audience_demographics
// tells us who her content actually reaches (followers + non-followers), which is
// the stronger, larger number a brand cares about. Best-effort: skipped on error.
async function fetchReachedDemographics(token) {
  const rows = [];
  const now = new Date().toISOString();
  for (const breakdown of ['country', 'city']) {
    try {
      const data = await ig(
        `/me/insights?metric=reached_audience_demographics&period=lifetime&timeframe=last_30_days&breakdown=${breakdown}&metric_type=total_value`,
        token
      );
      const metric = data.data?.[0];
      if (!metric) continue;
      const breakdownData = metric.total_value?.breakdowns?.[0]?.results || [];
      breakdownData.forEach(item => {
        rows.push({
          synced_at: now,
          metric: 'reached_audience_demographics',
          breakdown,
          dimension: item.dimension_values?.[0] ?? item.dimension_value ?? String(item.value),
          value: item.value,
        });
      });
      await sleep(300);
    } catch {
      // Requires the metric to be available for the account — skip if not.
    }
  }
  return rows;
}

// ── 5. Fetch daily account metrics ───────────────────────────────────────────
async function fetchDailySnapshot(token) {
  try {
    const [profileRes, insightsRes] = await Promise.all([
      ig('/me?fields=followers_count,media_count', token),
      ig('/me/insights?metric=reach,profile_views,website_clicks&period=day', token).catch(() => ({ data: [] })),
    ]);

    const insightMap = {};
    (insightsRes.data || []).forEach(m => {
      const latest = m.values?.[m.values.length - 1];
      if (latest) insightMap[m.name] = latest.value;
    });

    return {
      snapshot_date: new Date().toISOString().slice(0, 10),
      followers_count: profileRes.followers_count ?? null,
      media_count: profileRes.media_count ?? null,
      reach_day: insightMap.reach ?? null,
      profile_views: insightMap.profile_views ?? null,
      website_clicks: insightMap.website_clicks ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort gross follows / unfollows for the day.
 *
 * Deliberately additive, never load-bearing. Net growth is already derivable
 * from followers_count day over day, which is the number the ads scoreboard
 * actually needs; this only adds the gross split when Instagram will give it.
 *
 * The metric is `follows_and_unfollows` (period=day, metric_type=total_value,
 * breakdown=follow_type). Its documented breakdown values describe follower
 * status rather than the action, so rather than assume a mapping we look for an
 * explicit UNFOLLOW-style key and return nulls when the shape is anything else.
 * A null here is honest missing data; a guess would silently corrupt the only
 * table we use to judge whether ad spend works.
 */
async function fetchFollowsUnfollows(token) {
  const empty = { follows: null, unfollows: null };
  try {
    const res = await ig(
      '/me/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type',
      token
    );
    const results = res?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
    if (!Array.isArray(results) || !results.length) return empty;

    let follows = null;
    let unfollows = null;
    for (const r of results) {
      const key = String(r?.dimension_values?.[0] || '').toUpperCase();
      const value = Number(r?.value);
      if (!Number.isFinite(value)) continue;
      if (key.includes('UNFOLLOW')) unfollows = (unfollows || 0) + value;
      else if (key.includes('FOLLOW')) follows = (follows || 0) + value;
    }
    // Only trust the pair when both sides were actually identified.
    return (follows != null && unfollows != null) ? { follows, unfollows } : empty;
  } catch {
    return empty;
  }
}

// ── 6. Hero reels: mirror the 3 featured world-page reels into Storage ─────────
// fashion/luxury/wellness each play one reel inline, served from durable Storage
// URLs (raw IG CDN links carry a short-lived signature and can't be hot-linked).
// Idempotent: once an MP4 is present, the run is just a cheap existence check.
const STORAGE_BUCKET = 'instagram-media';
const HERO_REELS = [
  { id: '17981299715726595', date: '2024-09' }, // fashion  — C_kWOKeSTOC
  { id: '17864973993416569', date: '2025-10' }, // luxury   — DQFBjejj7Ko
  { id: '18049988218732844', date: '2024-05' }, // wellness — C7dg7qONh7V
];

async function storageExists(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/info/public/${STORAGE_BUCKET}/${path}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  return res.ok;
}

async function ensureHeroReels(token) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  let present = 0, mirrored = 0;
  for (const reel of HERO_REELS) {
    const path = `videos/${reel.date}/${reel.id}.mp4`;
    if (await storageExists(path)) { present++; continue; }
    // Resolve a fresh, signed CDN url for the reel, then copy it into Storage.
    const meta = await ig(`/${reel.id}?fields=media_url`, token);
    if (!meta.media_url) continue;
    const media = await fetch(meta.media_url);
    if (!media.ok) continue;
    const buffer = await media.arrayBuffer();
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'video/mp4',
        'Cache-Control': '31536000',
      },
      body: buffer,
    });
    if (up.ok) mirrored++;
  }
  return { present, mirrored };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const validCron   = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validManual = !!process.env.MANUAL_SYNC_KEY && authHeader === `Bearer ${process.env.MANUAL_SYNC_KEY}`;
  if (!validCron && !validManual) return res.status(401).end();

  const token = await getIgToken();
  if (!token) return res.status(500).json({ error: 'No INSTAGRAM_ACCESS_TOKEN' });

  const log = [];
  const start = Date.now();

  try {
    // ── Step 1: Newest posts (bounded) ──
    log.push(`Fetching newest ${RECENT_LIMIT} posts...`);
    const recent = await fetchRecentMedia(token, RECENT_LIMIT);
    const recentIds = new Set(recent.map(p => p.id));
    log.push(`Fetched ${recent.length} recent posts`);

    // ── Step 2: Insights + upsert for recent posts (full rows), batches of 25 ──
    let insightsDone = 0;
    const BATCH = 25;

    for (let i = 0; i < recent.length; i += BATCH) {
      const batch = recent.slice(i, i + BATCH);
      const now = new Date().toISOString();

      const upserts = await Promise.all(batch.map(async (post) => {
        const insights = await fetchInsights(post.id, post.media_type, token);
        return {
          id: post.id,
          media_type: post.media_type,
          caption: post.caption ?? null,
          permalink: post.permalink ?? null,
          timestamp: post.timestamp ?? null,
          like_count: post.like_count ?? null,
          comments_count: post.comments_count ?? null,
          is_shared_to_feed: post.is_shared_to_feed ?? null,
          original_media_url: post.media_url ?? null,
          original_thumbnail_url: post.thumbnail_url ?? null,
          // Insights
          reach: insights.reach ?? null,
          likes: insights.likes ?? null,
          comments: insights.comments ?? null,
          shares: insights.shares ?? null,
          saved: insights.saved ?? null,
          total_interactions: insights.total_interactions ?? null,
          views: insights.views ?? null,
          ig_reels_avg_watch_time: insights.ig_reels_avg_watch_time ?? null,
          ig_reels_video_view_total_time: insights.ig_reels_video_view_total_time ?? null,
          synced_at: now,
          insights_synced_at: Object.keys(insights).length > 0 ? now : null,
        };
      }));

      await sb('/instagram_posts?on_conflict=id', {
        method: 'POST',
        body: JSON.stringify(upserts),
      });

      insightsDone += batch.length;
    }
    log.push(`Synced ${insightsDone} recent posts with insights`);

    // ── Step 2b: Rolling insights-only refresh for older posts ──
    // Keeps the rest of the catalogue's lifetime insights from going fully stale,
    // a bounded slice at a time, without touching post metadata. Insight-only
    // payload → on conflict PostgREST updates just these columns, leaving
    // caption/permalink/timestamp/synced_at intact.
    try {
      const stale = (await fetchStaleInsightPosts(ROLL_LIMIT)).filter(r => !recentIds.has(r.id));
      let rolledDone = 0;
      for (let i = 0; i < stale.length; i += BATCH) {
        const batch = stale.slice(i, i + BATCH);
        const now = new Date().toISOString();
        const upserts = await Promise.all(batch.map(async (row) => {
          const insights = await fetchInsights(row.id, row.media_type, token);
          return {
            id: row.id,
            reach: insights.reach ?? row.reach ?? null,
            likes: insights.likes ?? row.likes ?? null,
            comments: insights.comments ?? row.comments ?? null,
            shares: insights.shares ?? row.shares ?? null,
            saved: insights.saved ?? row.saved ?? null,
            total_interactions: insights.total_interactions ?? row.total_interactions ?? null,
            views: insights.views ?? row.views ?? null,
            ig_reels_avg_watch_time: insights.ig_reels_avg_watch_time ?? row.ig_reels_avg_watch_time ?? null,
            ig_reels_video_view_total_time: insights.ig_reels_video_view_total_time ?? row.ig_reels_video_view_total_time ?? null,
            // Stamp even on empty fetch so deleted/insightless posts rotate out of
            // the stale queue instead of blocking it forever.
            insights_synced_at: now,
          };
        }));
        await sb('/instagram_posts?on_conflict=id', {
          method: 'POST',
          body: JSON.stringify(upserts),
        });
        rolledDone += batch.length;
      }
      log.push(`Rolling-refreshed insights for ${rolledDone} older posts`);
    } catch (e) {
      log.push(`Rolling insights error: ${e.message}`);
    }

    // ── Step 3: Carousel children for recent carousels (batches of 20) ──
    try {
      const carousels = recent.filter(p => p.media_type === 'CAROUSEL_ALBUM');
      let childrenDone = 0;
      const C_BATCH = 20;
      for (let i = 0; i < carousels.length; i += C_BATCH) {
        const batch = carousels.slice(i, i + C_BATCH);
        const results = await Promise.all(batch.map(async (post) => {
          const children = await fetchCarouselChildren(post.id, token);
          if (!children.length) return 0;
          const rows = children.map((child, idx) => ({
            id: child.id,
            parent_id: post.id,
            sort_order: idx,
            media_type: child.media_type ?? null,
            original_url: child.media_url ?? child.thumbnail_url ?? null,
            synced_at: new Date().toISOString(),
          }));
          await sb('/instagram_carousel_children?on_conflict=id', {
            method: 'POST',
            body: JSON.stringify(rows),
          });
          return rows.length;
        }));
        childrenDone += results.reduce((a, b) => a + b, 0);
      }
      log.push(`Upserted ${childrenDone} carousel children across ${carousels.length} carousels`);
    } catch (e) {
      log.push(`Carousel children error: ${e.message}`);
    }

    // ── Step 4: Demographics (follower + reached, written in one generation) ──
    try {
      const [followerRows, reachedRows] = await Promise.all([
        fetchDemographics(token),
        fetchReachedDemographics(token),
      ]);
      const demoRows = [...followerRows, ...reachedRows];
      if (demoRows.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await sb(`/instagram_demographics?synced_at=gte.${today}T00:00:00Z`, { method: 'DELETE' });
        await sb('/instagram_demographics', {
          method: 'POST',
          body: JSON.stringify(demoRows),
        });
        log.push(`Saved ${followerRows.length} follower + ${reachedRows.length} reached demographic rows`);
      } else {
        log.push('Demographics: skipped (no data or permission missing)');
      }
    } catch (e) {
      log.push(`Demographics error: ${e.message}`);
    }

    // ── Step 5: Daily snapshot ──
    try {
      const snapshot = await fetchDailySnapshot(token);
      if (snapshot) {
        await sb('/instagram_snapshots?on_conflict=snapshot_date', {
          method: 'POST',
          body: JSON.stringify([snapshot]),
        });
        log.push(`Snapshot saved for ${snapshot.snapshot_date}: ${snapshot.followers_count} followers`);

        // Mirror into instagram_daily_metrics, the table the ads scoreboard reads
        // to answer the only question that matters: did the spend move followers.
        // followers_count is the dependable signal — day-over-day difference is
        // net growth. Gross follows/unfollows are attempted separately and are
        // allowed to be null, because that metric is not reliably available.
        const gross = await fetchFollowsUnfollows(token);
        await sb('/instagram_daily_metrics?on_conflict=metric_date', {
          method: 'POST',
          body: JSON.stringify([{
            metric_date: snapshot.snapshot_date,
            follower_count: snapshot.followers_count,
            reach: snapshot.reach_day,
            profile_views: snapshot.profile_views,
            website_clicks: snapshot.website_clicks,
            follows: gross.follows,
            unfollows: gross.unfollows,
          }]),
        });
        log.push(`Daily metrics saved for ${snapshot.snapshot_date}`
          + (gross.follows == null ? ' (gross follows unavailable)' : ` (+${gross.follows}/-${gross.unfollows})`));
      }
    } catch (e) {
      log.push(`Snapshot error: ${e.message}`);
    }

    // ── Step 6: Mirror featured world-page reels into Storage (idempotent) ──
    try {
      const { present, mirrored } = await ensureHeroReels(token);
      log.push(`Hero reels: ${present} already present, ${mirrored} newly mirrored`);
    } catch (e) {
      log.push(`Hero reels error: ${e.message}`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return res.status(200).json({ ok: true, elapsed: `${elapsed}s`, log });

  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
