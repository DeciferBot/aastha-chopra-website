/**
 * Instagram → Supabase Full Sync
 * --------------------------------
 * Fetches ALL posts from Instagram Graph API, downloads images/thumbnails
 * to Supabase Storage, and upserts everything into the database.
 *
 * Usage:
 *   node scripts/sync-instagram.mjs              # images + thumbnails only
 *   node scripts/sync-instagram.mjs --videos     # also download reel MP4s
 *   node scripts/sync-instagram.mjs --limit 50   # sync latest 50 only
 *   node scripts/sync-instagram.mjs --insights   # also fetch per-post insights
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

// Load .env.local
const envPath = resolve(__dirname, '../.env.local');
const env = {};
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}

const IG_TOKEN     = env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID   = env.INSTAGRAM_USER_ID      || process.env.INSTAGRAM_USER_ID;
const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxenZheXR2eW5yZ2xpanZ3anN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU1MTUzMywiZXhwIjoyMDk2MTI3NTMzfQ.oDkOn85Ibdd2zhplNh_ocKecaTu5qoehQ-Ht3KlKhxA';
const BUCKET       = 'instagram-media';

const ARGS         = process.argv.slice(2);
const DOWNLOAD_VIDEOS  = ARGS.includes('--videos');
const FETCH_INSIGHTS   = ARGS.includes('--insights');
const LIMIT_ARG        = ARGS.indexOf('--limit');
const MAX_POSTS        = LIMIT_ARG >= 0 ? parseInt(ARGS[LIMIT_ARG + 1]) : Infinity;

const MEDIA_FIELDS = [
  'id','media_type','caption','permalink','timestamp',
  'like_count','comments_count','is_shared_to_feed',
  'media_url','thumbnail_url','children{id,media_type,media_url}'
].join(',');

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function igFetch(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`IG API: ${data.error.message} (code ${data.error.code})`);
  return data;
}

async function downloadToStorage(url, storagePath, contentType) {
  // Check if already exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/info/public/${BUCKET}/${storagePath}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (checkRes.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  // Download from Instagram CDN
  const mediaRes = await fetch(url);
  if (!mediaRes.ok) throw new Error(`Download failed: ${mediaRes.status} for ${url}`);
  const buffer = await mediaRes.arrayBuffer();

  // Upload to Supabase Storage
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': contentType,
        'Cache-Control': '3600',
      },
      body: buffer,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed: ${err}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function fetchInsights(postId, mediaType) {
  let metrics;
  if (mediaType === 'VIDEO') {
    metrics = 'reach,likes,comments,shares,saved,total_interactions,views,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
  } else {
    metrics = 'reach,likes,comments,shares,saved,total_interactions';
  }

  try {
    const data = await igFetch(
      `https://graph.instagram.com/v21.0/${postId}/insights?metric=${metrics}&period=lifetime&access_token=${IG_TOKEN}`
    );
    const flat = {};
    (data.data || []).forEach(m => { flat[m.name] = m.values?.[0]?.value ?? null; });
    return flat;
  } catch (e) {
    console.warn(`  ⚠ Insights failed for ${postId}: ${e.message}`);
    return {};
  }
}

async function upsertPost(row) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?on_conflict=id`,
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DB upsert failed: ${err}`);
  }
}

async function upsertCarouselChild(row) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_carousel_children?on_conflict=id`,
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
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!IG_TOKEN) { console.error('❌  INSTAGRAM_ACCESS_TOKEN not set'); process.exit(1); }

  console.log('🔄  Starting Instagram sync');
  console.log(`    Download videos: ${DOWNLOAD_VIDEOS}`);
  console.log(`    Fetch insights:  ${FETCH_INSIGHTS}`);
  console.log(`    Max posts:       ${MAX_POSTS === Infinity ? 'all' : MAX_POSTS}`);
  console.log('');

  // ── 1. Collect all posts from Instagram ─────────────────────────────────────
  let allPosts = [];
  let nextUrl = `https://graph.instagram.com/v21.0/${IG_USER_ID}/media?fields=${MEDIA_FIELDS}&limit=50&access_token=${IG_TOKEN}`;

  console.log('📥  Fetching post list from Instagram...');
  while (nextUrl && allPosts.length < MAX_POSTS) {
    const data = await igFetch(nextUrl);
    allPosts = allPosts.concat(data.data || []);
    nextUrl = data.paging?.next || null;
    process.stdout.write(`\r    Fetched ${allPosts.length} posts...`);
    if (nextUrl) await sleep(300); // rate limit buffer
  }
  allPosts = allPosts.slice(0, MAX_POSTS);
  console.log(`\n✅  ${allPosts.length} posts to process\n`);

  // ── 2. Process each post ─────────────────────────────────────────────────────
  let done = 0, skipped = 0, errors = 0;

  for (const post of allPosts) {
    const label = `[${++done}/${allPosts.length}] ${post.id} (${post.media_type})`;
    process.stdout.write(`  ${label}... `);

    try {
      const row = {
        id:                    post.id,
        media_type:            post.media_type,
        caption:               post.caption || null,
        permalink:             post.permalink || null,
        timestamp:             post.timestamp || null,
        like_count:            post.like_count || 0,
        comments_count:        post.comments_count || 0,
        is_shared_to_feed:     post.is_shared_to_feed || false,
        original_media_url:    post.media_url || null,
        original_thumbnail_url: post.thumbnail_url || null,
        synced_at:             new Date().toISOString(),
        media_downloaded:      false,
      };

      // ── Download media to Supabase Storage ──────────────────────────────────
      const datePrefix = post.timestamp
        ? new Date(post.timestamp).toISOString().slice(0, 7) // YYYY-MM
        : 'unknown';

      if (post.media_type === 'IMAGE' && post.media_url) {
        row.storage_image_url = await downloadToStorage(
          post.media_url,
          `images/${datePrefix}/${post.id}.jpg`,
          'image/jpeg'
        );
        row.media_downloaded = true;

      } else if (post.media_type === 'VIDEO') {
        // Always download thumbnail
        if (post.thumbnail_url) {
          row.storage_thumbnail_url = await downloadToStorage(
            post.thumbnail_url,
            `thumbnails/${datePrefix}/${post.id}.jpg`,
            'image/jpeg'
          );
          row.media_downloaded = true;
        }
        // Optionally download full video
        if (DOWNLOAD_VIDEOS && post.media_url) {
          row.storage_video_url = await downloadToStorage(
            post.media_url,
            `videos/${datePrefix}/${post.id}.mp4`,
            'video/mp4'
          );
        }

      } else if (post.media_type === 'CAROUSEL_ALBUM') {
        // Download cover (first child or media_url)
        if (post.media_url) {
          row.storage_image_url = await downloadToStorage(
            post.media_url,
            `images/${datePrefix}/${post.id}_cover.jpg`,
            'image/jpeg'
          );
          row.media_downloaded = true;
        }
        // Download all carousel children
        const children = post.children?.data || [];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!child.media_url) continue;
          const isVideo = child.media_type === 'VIDEO';
          const ext = isVideo ? 'mp4' : 'jpg';
          const ct  = isVideo ? 'video/mp4' : 'image/jpeg';
          const storageUrl = await downloadToStorage(
            child.media_url,
            `images/${datePrefix}/${post.id}_${i + 1}.${ext}`,
            ct
          );
          await upsertCarouselChild({
            id: child.id,
            parent_id: post.id,
            sort_order: i,
            media_type: child.media_type,
            storage_url: storageUrl,
            original_url: child.media_url,
          });
        }
      }

      // ── Fetch insights ───────────────────────────────────────────────────────
      if (FETCH_INSIGHTS) {
        const insights = await fetchInsights(post.id, post.media_type);
        Object.assign(row, {
          reach:                         insights.reach ?? null,
          likes:                         insights.likes ?? null,
          comments:                      insights.comments ?? null,
          shares:                        insights.shares ?? null,
          saved:                         insights.saved ?? null,
          total_interactions:            insights.total_interactions ?? null,
          views:                         insights.views ?? null,
          ig_reels_avg_watch_time:       insights.ig_reels_avg_watch_time ?? null,
          ig_reels_video_view_total_time: insights.ig_reels_video_view_total_time ?? null,
          insights_synced_at:            new Date().toISOString(),
        });
        await sleep(200); // rate limit buffer for insights
      }

      await upsertPost(row);
      console.log('✅');

    } catch (e) {
      console.log(`❌  ${e.message}`);
      errors++;
    }

    await sleep(150); // gentle rate limiting
  }

  // ── 3. Account snapshot ──────────────────────────────────────────────────────
  console.log('\n📊  Saving account snapshot...');
  try {
    const account = await igFetch(
      `https://graph.instagram.com/v21.0/${IG_USER_ID}?fields=followers_count,media_count&access_token=${IG_TOKEN}`
    );
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_snapshots?on_conflict=snapshot_date`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        snapshot_date:   new Date().toISOString().slice(0, 10),
        followers_count: account.followers_count,
        media_count:     account.media_count,
      }),
    });
    console.log(`✅  Followers: ${account.followers_count.toLocaleString()} | Posts: ${account.media_count}`);
  } catch (e) {
    console.warn(`⚠  Snapshot failed: ${e.message}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`✅  Done — ${done - errors} synced, ${errors} errors`);
  console.log(`    Images + thumbnails stored in Supabase Storage`);
  if (DOWNLOAD_VIDEOS) console.log(`    Videos stored in Supabase Storage`);
  console.log('─────────────────────────────────────');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
