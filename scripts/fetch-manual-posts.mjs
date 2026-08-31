/**
 * Photos for hand-added trips → data/travel-manual-posts.json (+ thumbnails)
 * -----------------------------------------------------------------------------
 * Some of Aastha's best travel posts never say where they were taken. The reel
 * she shot in Vietnam is captioned "2026 Goals". A word search will never find
 * it, so those posts get listed by hand in data/travel-manual.json and this
 * pulls in their picture, date and view count.
 *
 * It also adds their pictures to data/travel-thumbs.json so the map can show
 * them without asking the internet for anything.
 *
 * Usage:
 *   node scripts/fetch-manual-posts.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
} catch { /* rely on real env */ }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uqzvaytvynrglijvwjsz.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!KEY) { console.error('Missing SUPABASE_ANON_KEY. Set it and re-run.'); process.exit(1); }

const manual = JSON.parse(readFileSync(resolve(__dirname, '../data/travel-manual.json'), 'utf8'));
const wanted = [];
for (const t of manual.trips || []) {
  for (const link of t.postLinks || []) {
    // The bit between /reel/ or /p/ and the next slash is the post's own code.
    const code = (link.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (code) wanted.push({ code, link });
    else console.log(`  could not read a post code out of: ${link}`);
  }
}
if (!wanted.length) { console.log('No hand-added posts to fetch.'); process.exit(0); }
console.log(`${wanted.length} hand-added post(s) to fetch.`);

const rows = [];
for (const w of wanted) {
  const url = `${SUPABASE_URL}/rest/v1/instagram_posts`
    + `?select=id,caption,permalink,timestamp,like_count,comments_count,views,storage_thumbnail_url,storage_image_url,original_thumbnail_url`
    + `&permalink=ilike.*${encodeURIComponent(w.code)}*`;
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Supabase said ${res.status}: ${await res.text()}`);
  const found = await res.json();
  if (!found.length) { console.log(`  not in the archive yet: ${w.link}`); continue; }
  rows.push(found[0]);
}

// Shrink the pictures the same way the main packer does.
const SIZE = Number(process.env.SIZE || 560);
const QUALITY = Number(process.env.QUALITY || 64);
const tmp = resolve(__dirname, '../.thumb-tmp-manual');
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(tmp, { recursive: true });

const thumbsPath = resolve(__dirname, '../data/travel-thumbs.json');
let thumbs = {};
try { thumbs = JSON.parse(readFileSync(thumbsPath, 'utf8')); } catch { /* first run */ }

const posts = [];
for (const r of rows) {
  const src = r.storage_thumbnail_url || r.storage_image_url || r.original_thumbnail_url;
  if (src && !thumbs[r.id]) {
    const raw = resolve(tmp, `${r.id}.in`);
    const out = resolve(tmp, `${r.id}.jpg`);
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      execFileSync('sips', ['-s','format','jpeg','-s','formatOptions',String(QUALITY),'-Z',String(SIZE), raw, '--out', out], { stdio: 'ignore' });
      thumbs[r.id] = `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
    } catch (err) {
      console.log(`  no picture for ${r.permalink}: ${err.message}`);
    }
  }
  posts.push({
    postId: r.id,
    date: r.timestamp.slice(0, 10),
    permalink: r.permalink,
    caption: (r.caption || '').slice(0, 400),
    views: r.views || null,
    likes: r.like_count || 0,
    // The page on her own site loads pictures from this address rather than
    // carrying them inside the page, so it stays light and stays sharp.
    thumbnail: src || null,
  });
}
rmSync(tmp, { recursive: true, force: true });

writeFileSync(thumbsPath, JSON.stringify(thumbs));
writeFileSync(resolve(__dirname, '../data/travel-manual-posts.json'), JSON.stringify(posts, null, 2));
console.log(`\n${posts.length} post(s) saved to data/travel-manual-posts.json.`);
console.log('Now run: node scripts/build-travel-map.mjs');
