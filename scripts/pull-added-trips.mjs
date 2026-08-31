/**
 * Trips added on the page → data/travel-manual.json
 * -----------------------------------------------------------------------------
 * When Aastha adds a trip on the map itself, it lives in the saved copy of that
 * page and nowhere else. Rebuilding the map from the files here would wipe it.
 *
 * So: before ever rebuilding the map, fetch the live copy of the page and run
 * this against it. Anything she added is copied into data/travel-manual.json,
 * where the builder already knows to look. Trips already listed are left alone,
 * so running it twice is safe.
 *
 * Getting the live copy: ask Claude to read the map artifact. It saves the page
 * to a file and tells you the path. Then:
 *
 *   node scripts/pull-added-trips.mjs <path-to-that-file>
 *   node scripts/fetch-manual-posts.mjs
 *   node scripts/build-travel-map.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = process.argv[2];

if (!pagePath) {
  console.error('Give me the file holding the live copy of the map page.');
  console.error('  node scripts/pull-added-trips.mjs <path-to-page.html>');
  process.exit(1);
}

const html = readFileSync(pagePath, 'utf8');
const found = html.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/);
if (!found) {
  console.error('That file does not look like the map page. No saved trips inside it.');
  process.exit(1);
}
const live = JSON.parse(found[1].replace(/<\\\//g, '</'));

const added = (live.trips || []).filter(t => t.addedOnPage);
if (!added.length) {
  console.log('Nothing new has been added on the page.');
  process.exit(0);
}

const manualPath = resolve(__dirname, '../data/travel-manual.json');
const manual = JSON.parse(readFileSync(manualPath, 'utf8'));
manual.trips ||= [];

// Two entries are the same trip if they cover the same countries on the same day.
const key = t => (t.countries || []).slice().sort().join('+') + '@' + t.start;
const known = new Set(manual.trips.map(key));

let kept = 0;
for (const t of added) {
  if (known.has(key(t))) continue;
  manual.trips.push({
    countries: t.countries,
    start: t.start,
    end: t.end || t.start,
    monthOnly: false,
    note: 'Added on the map page itself.',
    postLinks: t.postLinks || (t.posts || []).map(p => p.link).filter(Boolean),
  });
  known.add(key(t));
  kept++;
  console.log(`  kept: ${t.countries.join(' and ')}, ${t.start}`);
}

if (!kept) {
  console.log(`${added.length} trip(s) added on the page, all already written down here.`);
  process.exit(0);
}

writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(`\n${kept} trip(s) copied into data/travel-manual.json.`);
console.log('Now run: node scripts/fetch-manual-posts.mjs && node scripts/build-travel-map.mjs');
