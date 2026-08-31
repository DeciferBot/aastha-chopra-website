/**
 * Travel thumbnails → data/travel-thumbs.json
 * -----------------------------------------------------------------------------
 * The ratify page has to work with no internet connection to any other site,
 * so every photo has to be baked into the page itself. This downloads the
 * picture for each candidate post, shrinks it to a small square, and stores it
 * as text that can be pasted straight into the page.
 *
 * Run scripts/scan-travel.mjs first. Photos that have expired on Instagram's
 * side are skipped and the page shows a plain tile instead.
 *
 * Usage:
 *   node scripts/pack-travel-thumbs.mjs
 *   (SIZE defaults to 220 pixels, QUALITY to 55)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = Number(process.env.SIZE || 560);
const QUALITY = Number(process.env.QUALITY || 64);

const candidates = JSON.parse(readFileSync(resolve(__dirname, '../data/travel-candidates.json'), 'utf8'));
const tmp = resolve(__dirname, '../.thumb-tmp');
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(tmp, { recursive: true });

const jobs = [];
for (const trip of candidates.trips) {
  for (const post of trip.posts) {
    if (post.thumbnail) jobs.push({ id: post.postId, url: post.thumbnail });
  }
}
// The same post can turn up under two countries. Only fetch it once.
const unique = [...new Map(jobs.map(j => [j.id, j])).values()];
console.log(`${unique.length} pictures to fetch.`);

const thumbs = {};
let done = 0, failed = 0;

// Instagram's own links expire, and an expired one can hang forever instead of
// failing, so every fetch gets a hard stop.
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

for (const job of unique) {
  const raw = resolve(tmp, `${job.id}.in`);
  const out = resolve(tmp, `${job.id}.jpg`);
  try {
    const res = await fetch(job.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    // sips ships with macOS, so there is nothing to install.
    execFileSync('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(QUALITY),
      '-Z', String(SIZE),
      raw, '--out', out,
    ], { stdio: 'ignore' });
    thumbs[job.id] = `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`;
    done++;
  } catch (err) {
    failed++;
    console.log(`  skipped ${job.id}: ${err.message}`);
  }
  if ((done + failed) % 20 === 0) console.log(`  ${done + failed}/${unique.length}`);
}

rmSync(tmp, { recursive: true, force: true });

const dest = resolve(__dirname, '../data/travel-thumbs.json');
writeFileSync(dest, JSON.stringify(thumbs));
const mb = (JSON.stringify(thumbs).length / 1048576).toFixed(2);
console.log(`\n${done} pictures saved, ${failed} could not be fetched. ${mb} MB total.`);
console.log('Written to data/travel-thumbs.json');
