export const config = { maxDuration: 300 };

/**
 * Instagram Full Sync — Vercel Cron
 * Runs every 4 hours. Pulls EVERYTHING:
 *   - All posts + reels (paginated, no cap)
 *   - Per-post insights (reach, saves, watch time, views, etc.)
 *   - Carousel children
 *   - Follower demographics (age, gender, city, country)
 *   - Daily account snapshot (followers, reach, profile views, website clicks)
 *
 * GET /api/cron/ig-sync
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const IG_BASE = 'https://graph.instagram.com/v21.0';

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

// ── 1. Fetch all media pages ──────────────────────────────────────────────────
async function fetchAllMedia(token) {
  const all = [];
  const seen = new Set();
  let after = null;

  while (true) {
    const qs = after
      ? `/me/media?fields=${MEDIA_FIELDS}&limit=50&after=${after}`
      : `/me/media?fields=${MEDIA_FIELDS}&limit=50`;
    const data = await ig(qs, token);
    const page = data.data || [];
    if (!page.length) break;

    // Stop if we've seen this cursor before (loop guard)
    const cursor = data.paging?.cursors?.after;
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);

    all.push(...page);

    // No next page
    if (!data.paging?.next || !cursor) break;
    after = cursor;
  }
  return all;
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

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const validCron   = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validManual = authHeader === `Bearer ${process.env.MANUAL_SYNC_KEY}`;
  if (!validCron && !validManual) return res.status(401).end();

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'No INSTAGRAM_ACCESS_TOKEN' });

  const log = [];
  const start = Date.now();

  try {
    // ── Step 1: All posts ──
    log.push('Fetching all media pages...');
    const allMedia = await fetchAllMedia(token);
    log.push(`Found ${allMedia.length} posts`);

    // ── Step 2: Insights + upsert in batches of 25 ──
    let insightsDone = 0;
    const BATCH = 25;

    for (let i = 0; i < allMedia.length; i += BATCH) {
      const batch = allMedia.slice(i, i + BATCH);
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
    log.push(`Upserted ${insightsDone} posts with insights`);

    // ── Step 3: Carousel children (batches of 20) ──
    try {
      const carousels = allMedia.filter(p => p.media_type === 'CAROUSEL_ALBUM');
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

    // ── Step 4: Demographics ──
    try {
      const demoRows = await fetchDemographics(token);
      if (demoRows.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await sb(`/instagram_demographics?synced_at=gte.${today}T00:00:00Z`, { method: 'DELETE' });
        await sb('/instagram_demographics', {
          method: 'POST',
          body: JSON.stringify(demoRows),
        });
        log.push(`Saved ${demoRows.length} demographic rows`);
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
      }
    } catch (e) {
      log.push(`Snapshot error: ${e.message}`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return res.status(200).json({ ok: true, elapsed: `${elapsed}s`, log });

  } catch (err) {
    return res.status(500).json({ error: err.message, log });
  }
}
