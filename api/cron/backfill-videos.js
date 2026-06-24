import { getIgToken } from '../_igtoken.js';

export const config = { maxDuration: 300 };

/**
 * Reel video backfill — downloads reel MP4s into durable Supabase Storage and
 * sets instagram_posts.storage_video_url, so the site can play reels natively
 * (durable URL) instead of the Instagram embed. Raw IG CDN links are signed and
 * expire within hours, so each reel's media_url is resolved fresh from the Graph
 * API at download time (same trick as the hero-reel mirror in ig-sync Step 6).
 *
 * Resumable + idempotent: processes the highest-view reels first, in bounded
 * batches under the 300s limit. Every attempt stamps video_backfill_attempted_at
 * so failed/deleted reels rotate out of the queue instead of blocking it. Call
 * repeatedly until { remainingAfter: 0 }.
 *
 * GET /api/cron/backfill-videos?limit=50   (Bearer MANUAL_SYNC_KEY or CRON_SECRET)
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const IG_BASE = 'https://graph.instagram.com/v21.0';
const BUCKET = 'instagram-media';
const CONCURRENCY = 5;

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
      Prefer: 'resolution=merge-duplicates,return=minimal',
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

// Count reels still needing a video (null url, not yet attempted).
async function remainingCount() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?media_type=eq.VIDEO&storage_video_url=is.null&video_backfill_attempted_at=is.null&select=id`,
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
  const key = process.env.SUPABASE_SERVICE_KEY;

  const limit = Math.min(parseInt(req.query?.limit, 10) || 50, 100);
  const start = Date.now();

  let remainingBefore = 0;
  try { remainingBefore = await remainingCount(); } catch {}

  const rows = await sb(
    `/instagram_posts?media_type=eq.VIDEO&storage_video_url=is.null&video_backfill_attempted_at=is.null`
    + `&select=id,timestamp,views,permalink&order=views.desc.nullslast&limit=${limit}`
  );

  let downloaded = 0, linkedExisting = 0, failed = 0, bytes = 0;
  const errors = [];
  const now = new Date().toISOString();

  async function processOne(p) {
    const datePrefix = p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 7) : 'unknown';
    const path = `videos/${datePrefix}/${p.id}.mp4`;
    const update = { id: p.id, video_backfill_attempted_at: now };
    try {
      if (await storageExists(path)) {
        update.storage_video_url = publicUrl(path);
        linkedExisting++;
      } else {
        const meta = await ig(`/${p.id}?fields=media_url`, token);
        if (!meta.media_url) throw new Error('no media_url (deleted/expired)');
        const media = await fetch(meta.media_url);
        if (!media.ok) throw new Error(`cdn ${media.status}`);
        const buf = await media.arrayBuffer();
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'video/mp4',
            'Cache-Control': '31536000',
            'x-upsert': 'true',
          },
          body: buf,
        });
        if (!up.ok) throw new Error(`upload ${up.status}`);
        update.storage_video_url = publicUrl(path);
        bytes += buf.byteLength;
        downloaded++;
      }
    } catch (e) {
      failed++;
      if (errors.length < 8) errors.push(`${p.id}: ${e.message}`);
    }
    // Always stamp the attempt (rotates failures out of the queue); set url on success.
    try { await sb('/instagram_posts?on_conflict=id', { method: 'POST', body: JSON.stringify([update]) }); } catch {}
  }

  for (let i = 0; i < (rows || []).length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(processOne));
  }

  const processed = rows?.length || 0;
  return res.status(200).json({
    ok: true,
    processed,
    downloaded,
    linkedExisting,
    failed,
    mb: +(bytes / 1048576).toFixed(1),
    remainingBefore,
    remainingAfter: Math.max(0, remainingBefore - processed),
    elapsed: `${((Date.now() - start) / 1000).toFixed(1)}s`,
    errors,
  });
}
