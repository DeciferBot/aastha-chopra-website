/**
 * Hero reels → Supabase Storage (durable MP4s for the inline feature players)
 * -----------------------------------------------------------------------------
 * The three world pages each play one reel inline (fashion / luxury / wellness).
 * Those <video> elements point at permanent Supabase Storage URLs of the form
 *   storage/v1/object/public/instagram-media/videos/<YYYY-MM>/<post_id>.mp4
 * — Instagram's own CDN links carry a short-lived signature and can't be
 * hot-linked, so we mirror the MP4 into Storage once (same pattern as the
 * thumbnails in scripts/sync-instagram.mjs).
 *
 * This script ensures those three MP4s exist: for each reel it checks Storage,
 * and if missing, resolves the post's fresh media_url from the Instagram Graph
 * API and uploads it. Idempotent — safe to re-run; already-present files are
 * left untouched.
 *
 * Requires INSTAGRAM_ACCESS_TOKEN (env or .env.local) only when a video still
 * needs downloading. Re-run after the access token is refreshed if a fetch 400s.
 *
 * Usage:
 *   node scripts/sync-hero-reels.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local (does not override real env)
const env = {};
try {
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}

const IG_TOKEN     = env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxenZheXR2eW5yZ2xpanZ3anN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU1MTUzMywiZXhwIjoyMDk2MTI3NTMzfQ.oDkOn85Ibdd2zhplNh_ocKecaTu5qoehQ-Ht3KlKhxA';
const BUCKET       = 'instagram-media';

// The three featured reels, one per world page. date = YYYY-MM of the post
// (matches the Storage path convention written by sync-instagram.mjs).
const REELS = [
  { world: 'fashion',  shortcode: 'C_kWOKeSTOC', id: '17981299715726595', date: '2024-09' },
  { world: 'luxury',   shortcode: 'DQFBjejj7Ko', id: '17864973993416569', date: '2025-10' },
  { world: 'wellness', shortcode: 'C7dg7qONh7V', id: '18049988218732844', date: '2024-05' },
];

const storagePath = r => `videos/${r.date}/${r.id}.mp4`;
const publicUrl   = r => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath(r)}`;

async function existsInStorage(r) {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/info/public/${BUCKET}/${storagePath(r)}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  return res.ok;
}

async function resolveMediaUrl(r) {
  if (!IG_TOKEN) throw new Error('INSTAGRAM_ACCESS_TOKEN not set — cannot resolve media_url');
  const res = await fetch(
    `https://graph.instagram.com/v21.0/${r.id}?fields=media_type,media_url&access_token=${IG_TOKEN}`
  );
  const data = await res.json();
  if (data.error) throw new Error(`IG API: ${data.error.message} (code ${data.error.code})`);
  if (!data.media_url) throw new Error(`No media_url for ${r.shortcode} (${r.id})`);
  return data.media_url;
}

async function upload(r, mediaUrl) {
  const media = await fetch(mediaUrl);
  if (!media.ok) throw new Error(`CDN download failed: ${media.status}`);
  const buffer = await media.arrayBuffer();
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath(r)}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'video/mp4',
      'Cache-Control': '31536000',
    },
    body: buffer,
  });
  if (!up.ok) throw new Error(`Upload failed: ${await up.text()}`);
}

async function main() {
  let ready = 0;
  for (const r of REELS) {
    process.stdout.write(`• ${r.world.padEnd(9)} ${r.shortcode} … `);
    try {
      if (await existsInStorage(r)) {
        console.log('already in Storage');
        ready++;
        continue;
      }
      const mediaUrl = await resolveMediaUrl(r);
      await upload(r, mediaUrl);
      console.log('uploaded ✓');
      ready++;
    } catch (e) {
      console.log(`FAILED — ${e.message}`);
    }
  }
  console.log(`\n${ready}/${REELS.length} hero reels available in Storage.`);
  console.log('Public URLs:');
  REELS.forEach(r => console.log(`  ${r.world}: ${publicUrl(r)}`));
  if (ready < REELS.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
