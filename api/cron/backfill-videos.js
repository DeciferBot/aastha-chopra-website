import { getIgToken } from '../_igtoken.js';

export const config = { maxDuration: 300 };

/**
 * Instagram media mirror — copies post media into durable Supabase Storage and
 * records the public URLs on instagram_posts, so the site can show covers and
 * play reels from links that never expire. Raw IG CDN links are signed and die
 * within hours, so every url is resolved fresh from the Graph API at copy time
 * (same trick as the hero-reel mirror in ig-sync Step 6).
 *
 * Per media type:
 *   VIDEO           → thumbnails/<YYYY-MM>/<id>.jpg  + videos/<YYYY-MM>/<id>.mp4
 *   IMAGE           → images/<YYYY-MM>/<id>.jpg
 *   CAROUSEL_ALBUM  → images/<YYYY-MM>/<id>_cover.jpg
 *
 * Runs on a cron 30 min after each ig-sync, so posts published between syncs get
 * their durable media shortly after the row itself lands. Resumable + idempotent:
 * bounded batches under the 300s limit, newest posts first, an existing Storage
 * object is just linked rather than re-downloaded. Every attempt stamps
 * video_backfill_attempted_at; a row is retried after RETRY_AFTER_DAYS so a
 * transient CDN failure doesn't park a post forever, while genuinely dead media
 * (deleted posts) only costs one attempt per week.
 *
 * GET /api/cron/backfill-videos?limit=50   (Bearer CRON_SECRET or MANUAL_SYNC_KEY)
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const IG_BASE = 'https://graph.instagram.com/v21.0';
const BUCKET = 'instagram-media';
const CONCURRENCY = 5;
const RETRY_AFTER_DAYS = 7;

async function ig(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${IG_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`IG: ${data.error.message}`);
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
      Prefer: 'return=minimal',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${opts.method || 'GET'} ${path}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function storageExists(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/info/public/${BUCKET}/${path}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  return res.ok;
}

const publicUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

// Copy one remote url into Storage and return its durable public url. Skips the
// download entirely when the object is already there.
async function mirror(sourceUrl, path, contentType) {
  if (await storageExists(path)) return { url: publicUrl(path), bytes: 0, copied: false };

  const key = process.env.SUPABASE_SERVICE_KEY;
  const media = await fetch(sourceUrl);
  if (!media.ok) throw new Error(`cdn ${media.status} for ${path}`);
  const buf = await media.arrayBuffer();

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': contentType,
      'Cache-Control': '31536000',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!up.ok) throw new Error(`upload ${up.status} for ${path}: ${await up.text()}`);

  return { url: publicUrl(path), bytes: buf.byteLength, copied: true };
}

// Posts still missing durable media. A VIDEO needs both a thumbnail and an mp4;
// IMAGE and CAROUSEL_ALBUM need a cover. Anything attempted within the retry
// window is left alone so failures rotate out instead of blocking the queue.
function pendingFilter(cutoff) {
  // Nested groups need the explicit and(...) form; a bare parenthesised list is
  // not valid PostgREST. media_type has exactly three values, so neq.VIDEO is
  // IMAGE or CAROUSEL_ALBUM and avoids nesting an in.(...) list inside a group.
  return '&or=('
    + 'and(media_type.eq.VIDEO,storage_thumbnail_url.is.null)'
    + ',and(media_type.eq.VIDEO,storage_video_url.is.null)'
    + ',and(media_type.neq.VIDEO,storage_image_url.is.null)'
    + ')'
    + `&or=(video_backfill_attempted_at.is.null,video_backfill_attempted_at.lt.${cutoff})`;
}

async function pendingCount(cutoff) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?select=id${pendingFilter(cutoff)}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' } }
  );
  return Number((res.headers.get('content-range') || '').split('/')[1] || 0);
}

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  const ok = auth === `Bearer ${process.env.CRON_SECRET}`
    || (!!process.env.MANUAL_SYNC_KEY && auth === `Bearer ${process.env.MANUAL_SYNC_KEY}`);
  if (!ok) return res.status(401).end();

  const token = await getIgToken();
  if (!token) return res.status(500).json({ error: 'No Instagram access token' });

  const limit = Math.min(parseInt(req.query?.limit, 10) || 50, 100);
  const start = Date.now();
  const now = new Date();
  const cutoff = new Date(now.getTime() - RETRY_AFTER_DAYS * 86400_000).toISOString();

  let remainingBefore = 0;
  try { remainingBefore = await pendingCount(cutoff); } catch {}

  // Newest first: a post published since the last run is what the site is waiting
  // on, and the historical tail has already been swept.
  const rows = await sb(
    '/instagram_posts?select=id,media_type,timestamp,permalink,'
    + 'storage_thumbnail_url,storage_video_url,storage_image_url'
    + pendingFilter(cutoff)
    + `&order=timestamp.desc.nullslast&limit=${limit}`
  );

  let copied = 0, linked = 0, failed = 0, writeFailed = 0, bytes = 0;
  const errors = [];

  async function processOne(p) {
    const datePrefix = p.timestamp
      ? new Date(p.timestamp).toISOString().slice(0, 7)
      : 'unknown';
    const update = { video_backfill_attempted_at: now.toISOString() };

    // One Graph API read gives fresh, signed urls for both the cover and the mp4.
    // Instagram leaves media_url OUT of the response for reels that use licensed
    // (copyrighted) audio, so some reels can never get an mp4 here — they keep the
    // thumbnail and the site plays them through the Instagram embed instead.
    // Verified 2026-08-19: reels with no mp4 return thumbnail_url but no media_url.
    let meta = {};
    try {
      meta = await ig(`/${p.id}?fields=media_url,thumbnail_url`, token);
    } catch (e) {
      failed++;
      if (errors.length < 10) errors.push(`${p.id}: ${e.message}`);
    }

    // Each asset is copied independently — a missing mp4 must not cost us the
    // thumbnail, which is what the reel grid actually renders.
    const jobs = [];
    if (p.media_type === 'VIDEO') {
      if (!p.storage_thumbnail_url && meta.thumbnail_url) {
        jobs.push(['storage_thumbnail_url', meta.thumbnail_url, `thumbnails/${datePrefix}/${p.id}.jpg`, 'image/jpeg']);
      }
      if (!p.storage_video_url && meta.media_url) {
        jobs.push(['storage_video_url', meta.media_url, `videos/${datePrefix}/${p.id}.mp4`, 'video/mp4']);
      }
    } else if (!p.storage_image_url && meta.media_url) {
      const name = p.media_type === 'CAROUSEL_ALBUM' ? `${p.id}_cover.jpg` : `${p.id}.jpg`;
      jobs.push(['storage_image_url', meta.media_url, `images/${datePrefix}/${name}`, 'image/jpeg']);
    }

    for (const [column, sourceUrl, path, contentType] of jobs) {
      try {
        const r = await mirror(sourceUrl, path, contentType);
        update[column] = r.url;
        bytes += r.bytes;
        r.copied ? copied++ : linked++;
      } catch (e) {
        failed++;
        if (errors.length < 10) errors.push(`${p.id}: ${e.message}`);
      }
    }

    // PATCH, not an upsert. A PostgREST upsert is an INSERT ... ON CONFLICT, so a
    // partial body trips the NOT NULL constraint on media_type and the whole write
    // is rejected — that is what silently broke the original backfill. A targeted
    // update touches only the columns we set. Write failures are surfaced, not
    // swallowed, otherwise the job re-downloads the same media forever.
    try {
      await sb(`/instagram_posts?id=eq.${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
    } catch (e) {
      writeFailed++;
      if (errors.length < 10) errors.push(`${p.id} write-back: ${e.message}`);
    }
  }

  for (let i = 0; i < (rows || []).length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(processOne));
  }

  const processed = rows?.length || 0;
  let remainingAfter = 0;
  try { remainingAfter = await pendingCount(cutoff); } catch {}

  return res.status(200).json({
    ok: true,
    processed,
    copied,
    linked,
    failed,
    writeFailed,
    mb: +(bytes / 1048576).toFixed(1),
    remainingBefore,
    remainingAfter,
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    errors,
  });
}
