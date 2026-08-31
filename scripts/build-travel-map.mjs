/**
 * Travel map → build/travel-map-artifact.html (+ a standalone copy)
 * -----------------------------------------------------------------------------
 * The page that goes in front of hotels. It shows only the trips Aastha ticked
 * as real in the ratify page, so nothing on it is a guess.
 *
 * The point is not where she went. It is that she is always either just back or
 * just about to go, while holding down a working life with kids at home. The
 * map shows the reach, the year strip shows that it never lets up, and tapping
 * a country brings up the real posts from that trip.
 *
 * No trips-per-year average anywhere on the page. Some years are five, some are
 * ten. An average reads like a limit.
 *
 * Inputs: data/travel-candidates.json, data/travel-verdicts.json,
 *         data/travel-thumbs.json, data/world-outline.json
 *
 * Usage:
 *   node scripts/build-travel-map.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(readFileSync(resolve(__dirname, '..', f), 'utf8'));

const candidates = read('data/travel-candidates.json');
const verdicts = read('data/travel-verdicts.json');
const thumbs = read('data/travel-thumbs.json');
const world = read('data/world-outline.json');

const HOME = { country: 'Dubai', lat: 25.20, lon: 55.27 };

/**
 * Read a photo's real width and height out of the picture itself.
 *
 * Her posts are almost all tall: reels are 9 wide by 16 high, feed photos are
 * 4 by 5. The page has to know each shape so it can show the whole picture
 * instead of slicing a strip out of the middle and cutting off heads.
 */
function jpegSize(dataUri) {
  const b = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
  let i = 2;
  while (i < b.length - 8) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Only what Aastha confirmed, minus the handful the captions plainly contradict.
 * A few product posts got ticked through: a Dior range named after the French
 * Riviera, an Indian brand opening in Dubai, a bag someone brought back from
 * Thailand. They are listed with their reason in data/travel-disputed.json and
 * held out here. A map that goes to hotels cannot claim a trip that did not
 * happen.
 */
let disputed = { excluded: [] };
try { disputed = read('data/travel-disputed.json'); } catch { /* none */ }
const heldBack = new Set(disputed.excluded.map(e => e.tripId));

const confirmed = candidates.trips
  .filter(t => verdicts[t.tripId] === 'yes' && !heldBack.has(t.tripId))
  .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
if (heldBack.size) console.log(`Held back as not really trips: ${[...heldBack].join(', ')}`);

/**
 * Countries visited within a few days of each other are one journey, not two.
 * Her February run was Finland, then Brussels, then Paris, then home, and one
 * card tells that far better than three.
 *
 * Keep this number small. At seven days it swallowed a separate Thailand trip
 * into the Finland one and invented a journey she never took. Four days keeps
 * the real multi-country runs together and leaves genuinely separate trips
 * apart. Anything that claims more than happened has to go.
 */
const JOURNEY_GAP_DAYS = 4;
const journeys = [];
for (const t of confirmed) {
  const last = journeys[journeys.length - 1];
  if (last && (new Date(t.firstDate) - new Date(last.end)) / 86400000 <= JOURNEY_GAP_DAYS) {
    last.legs.push(t);
    if (t.lastDate > last.end) last.end = t.lastDate;
  } else {
    journeys.push({ start: t.firstDate, end: t.lastDate, legs: [t] });
  }
}
journeys.reverse();

/**
 * Trips she took but never named in a caption. Vietnam is the proof this is
 * needed: not one post in 2,089 mentions it. These are typed in by hand in
 * data/travel-manual.json and carry no posts, so they show as a plain card.
 */
const PLACE_POS = {};
for (const t of candidates.trips) PLACE_POS[t.country] = { lat: t.lat, lon: t.lon };
// Where every other country's dot sits, shared with the picker on the page.
const EXTRA_POS = {};
for (const [country, [lat, lon]] of Object.entries(read('data/places.json').countries)) {
  EXTRA_POS[country] = { lat, lon };
}

let manual = { trips: [] };
try { manual = read('data/travel-manual.json'); } catch { /* none yet */ }
let manualPosts = [];
try { manualPosts = read('data/travel-manual-posts.json'); } catch { /* none yet */ }
const byLink = new Map(manualPosts.map(p => [p.permalink, p]));

const skipped = [];
for (const m of manual.trips || []) {
  if (!m.start) { skipped.push(m.countries.join(' and ')); continue; }
  // Posts she made on this trip that never named the place.
  const posts = (m.postLinks || [])
    .map(link => {
      const code = (link.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
      return manualPosts.find(p => code && p.permalink.includes(code)) || byLink.get(link);
    })
    .filter(Boolean);
  const legs = m.countries.map((country, i) => {
    const pos = PLACE_POS[country] || EXTRA_POS[country];
    if (!pos) throw new Error(`No map position for "${country}". Add it to EXTRA_POS in this script.`);
    return { country, lat: pos.lat, lon: pos.lon, posts: i === 0 ? posts : [] };
  });
  journeys.push({
    start: m.start,
    end: m.end || m.start,
    legs,
    byHand: true,
    monthOnly: m.monthOnly !== false,
  });
}
journeys.sort((a, b) => b.start.localeCompare(a.start));
if (skipped.length) console.log(`Waiting on a date: ${skipped.join(', ')}`);

const trips = journeys.map(j => {
  // Only the first four photos are ever shown on a card, so only those get
  // baked into the page. Carrying all of them made it far heavier for pictures
  // nobody sees.
  let shown = 0;
  const posts = j.legs.flatMap(l => l.posts)
    .filter((p, i, all) => all.findIndex(q => q.postId === p.postId) === i)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => {
      const img = thumbs[p.postId] && shown < 4 ? (shown++, thumbs[p.postId]) : null;
      const size = img ? jpegSize(img) : null;
      return {
        date: p.date,
        link: p.permalink,
        caption: p.caption.replace(/\s+/g, ' ').trim().slice(0, 180),
        views: p.views,
        likes: p.likes,
        img,
        w: size ? size.w : null,
        h: size ? size.h : null,
      };
    });
  const countries = [...new Set(j.legs.map(l => l.country))];
  return {
    id: j.start + '-' + countries.join('-').toLowerCase().replace(/[^a-z-]/g, ''),
    countries,
    stops: countries.map(c => {
      const leg = j.legs.find(l => l.country === c);
      return { country: c, lat: leg.lat, lon: leg.lon };
    }),
    start: j.start,
    end: j.end,
    year: Number(j.start.slice(0, 4)),
    byHand: !!j.byHand,
    monthOnly: !!j.monthOnly,
    posts,
  };
});

// One dot per country, sized by how many separate journeys took her there.
const dots = {};
for (const t of trips) {
  for (const s of t.stops) {
    const d = (dots[s.country] ||= { country: s.country, lat: s.lat, lon: s.lon, visits: 0, tripIds: [] });
    if (!d.tripIds.includes(t.id)) { d.visits++; d.tripIds.push(t.id); }
  }
}

const years = {};
for (const t of trips) (years[t.year] ||= []).push(t.id);
const yearList = Object.keys(years).map(Number).sort();

/**
 * The world outline, trimmed hard. Two decimal places is plenty at this size
 * and the specks are noise on a map about somebody's holidays. The frame is
 * cropped to the part of the world she actually travels in, so the page is not
 * three quarters empty ocean.
 */
const FRAME = { west: -22, east: 122, north: 71, south: -12 };
const round = n => Math.round(n * 100) / 100;

function cleanRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

const land = [];
for (const f of world.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const ring = cleanRing(poly[0]);
    if (!ring) continue;
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w * h < 2) continue;                                  // drop specks
    if (Math.max(...xs) < FRAME.west || Math.min(...xs) > FRAME.east) continue;
    if (Math.max(...ys) < FRAME.south || Math.min(...ys) > FRAME.north) continue;
    land.push(ring);
  }
}

const state = {
  trips,
  dots: Object.values(dots).sort((a, b) => b.visits - a.visits),
  home: HOME,
  years,
  yearList,
  frame: FRAME,
  land,
  // Every country Aastha can pick from when she adds a trip on the page.
  places: Object.fromEntries(
    Object.entries({ ...EXTRA_POS, ...PLACE_POS })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, p]) => [c, [p.lat, p.lon]])
  ),
  stats: {
    journeys: trips.length,
    countries: Object.keys(dots).length,
    posts: trips.reduce((n, t) => n + t.posts.length, 0),
    firstYear: yearList[0],
    lastYear: yearList[yearList.length - 1],
  },
};

const CSS = `
:root{
  --ground:#EAECEC; --panel:#FFFFFF; --panel-2:#F3F5F5;
  --sea:#DEE3E4; --land:#C4CBCB; --land-lit:#AEB7B7;
  --ink:#15191A; --ink-soft:#57605F; --ink-faint:#878F8E;
  --rule:#D1D7D7; --signal:#B8412B; --signal-soft:#F0DCD6; --deep:#1F4A55;
  --shadow:0 1px 2px rgba(21,25,26,.05), 0 16px 40px -22px rgba(21,25,26,.3);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0E1213; --panel:#161C1D; --panel-2:#1D2425;
    --sea:#101617; --land:#232F30; --land-lit:#2F3D3E;
    --ink:#E9EEEE; --ink-soft:#9BA5A5; --ink-faint:#6D7676;
    --rule:#232F30; --signal:#E0705A; --signal-soft:#2A1A16; --deep:#7FB3C0;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 16px 40px -22px rgba(0,0,0,.85);
  }
}
:root[data-theme="dark"]{
  --ground:#0E1213; --panel:#161C1D; --panel-2:#1D2425;
  --sea:#101617; --land:#232F30; --land-lit:#2F3D3E;
  --ink:#E9EEEE; --ink-soft:#9BA5A5; --ink-faint:#6D7676;
  --rule:#232F30; --signal:#E0705A; --signal-soft:#2A1A16; --deep:#7FB3C0;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 16px 40px -22px rgba(0,0,0,.85);
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"Public Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:15.5px; line-height:1.6; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1000px; margin:0 auto; padding:0 20px}
a{color:var(--deep)}
:focus-visible{outline:2px solid var(--signal); outline-offset:3px}

/* ---- opening ---- */
.hero{padding:56px 0 30px; max-width:720px}
.eyebrow{
  font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:11px;
  letter-spacing:.18em; text-transform:uppercase; color:var(--ink-faint); margin:0 0 18px;
}
h1{
  font-family:"Bodoni Moda", Didot, "Times New Roman", serif; font-weight:400;
  font-size:clamp(38px, 7vw, 68px); line-height:1.02; letter-spacing:-.015em;
  margin:0; text-wrap:balance;
}
h1 em{font-style:italic; color:var(--signal)}
.lede{font-size:17px; color:var(--ink-soft); margin:20px 0 0; max-width:52ch}

.stats{
  display:flex; flex-wrap:wrap; gap:34px; margin:34px 0 0;
  padding-top:26px; border-top:1px solid var(--rule);
}
.stat b{
  display:block; font-family:"Bodoni Moda", Didot, serif; font-weight:400;
  font-size:42px; line-height:1; font-variant-numeric:tabular-nums;
}
.stat span{
  display:block; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10.5px;
  letter-spacing:.13em; text-transform:uppercase; color:var(--ink-faint); margin-top:8px;
}

/* ---- map ---- */
.mapwrap{
  margin:44px 0 0; border:1px solid var(--rule); border-radius:14px;
  background:var(--sea); overflow:hidden; box-shadow:var(--shadow); position:relative;
}
svg.map{display:block; width:100%; height:auto}
.land{fill:var(--land); stroke:none}
.route{stroke:var(--ink-faint); stroke-width:1; fill:none; opacity:.45; stroke-dasharray:4 5}
.dot{cursor:pointer}
.dot circle.halo{fill:var(--signal); opacity:.16}
.dot circle.core{fill:var(--signal); stroke:var(--sea); stroke-width:1.6}
.dot text{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:9px; font-weight:500;
  fill:var(--ink); letter-spacing:.05em; paint-order:stroke;
  stroke:var(--sea); stroke-width:3px; stroke-linejoin:round;
}
.dot .leader{stroke:var(--ink-faint); stroke-width:.8; fill:none; opacity:.55}
.dot:hover circle.halo, .dot:focus-visible circle.halo{opacity:.34}
.dot.on circle.halo{opacity:.38}
.home circle{fill:none; stroke:var(--ink-faint); stroke-width:1.4}
.home text{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:8px; letter-spacing:.14em;
  fill:var(--ink-faint); paint-order:stroke; stroke:var(--sea); stroke-width:3px; stroke-linejoin:round;
}
@media (prefers-reduced-motion:no-preference){
  .dot{opacity:0; animation:pop .5s ease forwards}
  @keyframes pop{from{opacity:0; transform:scale(.4)} to{opacity:1; transform:scale(1)}}
}
.dot{transform-box:fill-box; transform-origin:center}

.legend{
  display:flex; gap:16px; flex-wrap:wrap; align-items:center; padding:11px 16px;
  border-top:1px solid var(--rule); background:var(--panel);
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; color:var(--ink-faint);
}

/* ---- year rhythm ---- */
.rhythm{margin:44px 0 0}
h2{
  font-family:"Bodoni Moda", Didot, serif; font-weight:400; font-size:30px;
  margin:0 0 6px; letter-spacing:-.01em;
}
.section-note{color:var(--ink-soft); font-size:14.5px; margin:0 0 22px; max-width:56ch}
.yearrow{
  display:grid; grid-template-columns:64px 1fr; gap:14px; align-items:center;
  padding:9px 0; border-top:1px solid var(--rule);
}
.yearrow:last-child{border-bottom:1px solid var(--rule)}
.yr{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:13px; color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
}
.pips{display:flex; gap:5px; flex-wrap:wrap}
.pip{
  width:26px; height:26px; border-radius:6px; border:1px solid var(--rule);
  background:var(--panel); cursor:pointer; padding:0; overflow:hidden;
}
.pip img{width:100%; height:100%; object-fit:cover; display:block}
.pip.on{border-color:var(--signal); box-shadow:0 0 0 2px var(--signal-soft)}

/* ---- trips ---- */
.trips{margin:52px 0 0}
.filterbar{display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 20px}
.pill{
  font:inherit; font-size:12.5px; padding:5px 12px; border-radius:99px; cursor:pointer;
  border:1px solid var(--rule); background:transparent; color:var(--ink-soft);
}
.pill[aria-pressed="true"]{background:var(--ink); color:var(--ground); border-color:var(--ink)}
/* Her photos are portrait, so the cards are laid out in columns and each one
   is as tall as its own picture. Nothing is squashed into a shared height. */
.grid{columns:3 300px; column-gap:16px}
@media (max-width:980px){ .grid{columns:2 280px} }
@media (max-width:620px){ .grid{columns:1} }
.trip{
  background:var(--panel); border:1px solid var(--rule); border-radius:13px;
  overflow:hidden; box-shadow:var(--shadow); scroll-margin-top:20px;
  break-inside:avoid; margin:0 0 16px; display:inline-block; width:100%;
}
.trip.lit{border-color:var(--signal)}

/* The cover keeps the shape it was shot in. No cropping, ever. */
.cover{display:block; width:100%; height:auto; background:var(--panel-2)}
.cover-none{
  padding:26px 16px; text-align:center; background:var(--panel-2);
  color:var(--ink-faint); font-size:13px;
}
.more{
  display:flex; gap:6px; flex-wrap:wrap; padding:12px 15px 0;
}
.more a{
  width:52px; height:52px; border-radius:7px; overflow:hidden; display:block;
  border:1px solid var(--rule); position:relative;
}
.more a img{width:100%; height:100%; object-fit:cover; display:block}
.more a:hover{border-color:var(--deep)}
.trip-b{padding:14px 15px 15px}
.route-line{
  font-family:"Bodoni Moda", Didot, serif; font-size:22px; line-height:1.2; margin:0;
}
.trip-when{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11.5px; color:var(--ink-faint);
  margin:5px 0 0; font-variant-numeric:tabular-nums;
}
.trip-cap{font-size:13.5px; color:var(--ink-soft); margin:11px 0 0}
.trip-links{display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 0}
.trip-links a{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10.5px; letter-spacing:.06em;
  text-transform:uppercase; text-decoration:none; color:var(--deep);
  border:1px solid var(--rule); border-radius:99px; padding:3px 9px;
}
.trip-links a:hover{border-color:var(--deep)}

footer{
  margin:64px 0 0; padding:22px 0 60px; border-top:1px solid var(--rule);
  color:var(--ink-faint); font-size:12.5px;
}

/* ---- adding a trip (only people with editing rights can save) ---- */
#adder[hidden]{display:none}
.adder-open{
  font:inherit; font-size:12px; color:var(--ink-faint); background:none; cursor:pointer;
  border:1px solid var(--rule); border-radius:99px; padding:4px 11px; margin-left:10px;
}
.adder-open:hover{color:var(--ink); border-color:var(--ink-faint)}
.adder-form{
  margin:16px 0 0; padding:18px; border:1px solid var(--rule); border-radius:12px;
  background:var(--panel); box-shadow:var(--shadow); max-width:520px;
}
.adder-form h3{
  font-family:"Bodoni Moda", Didot, serif; font-weight:400; font-size:22px; margin:0 0 4px;
}
.adder-form p.hint{color:var(--ink-soft); font-size:13px; margin:0 0 16px}
.field{display:flex; flex-direction:column; gap:5px; margin:0 0 13px}
.field label{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10.5px;
  letter-spacing:.11em; text-transform:uppercase; color:var(--ink-faint);
}
.field input, .field select, .field textarea{
  font:inherit; font-size:14.5px; color:var(--ink); background:var(--panel-2);
  border:1px solid var(--rule); border-radius:8px; padding:8px 10px; width:100%;
}
.field textarea{min-height:62px; resize:vertical; font-size:13px}
.field-row{display:flex; gap:12px}
.field-row .field{flex:1}
.adder-actions{display:flex; gap:9px; align-items:center; margin-top:4px}
.btn{
  font:inherit; font-size:13.5px; font-weight:600; padding:8px 16px; border-radius:8px;
  border:1px solid var(--deep); background:var(--deep); color:var(--ground); cursor:pointer;
}
.btn.quiet{background:transparent; color:var(--ink-soft); border-color:var(--rule); font-weight:400}
.btn[disabled]{opacity:.45; cursor:default}
.adder-msg{font-size:12.5px; color:var(--ink-soft); margin:10px 0 0; min-height:1.2em}
.adder-msg.bad{color:var(--signal)}
.pending{
  display:inline-block; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.09em; text-transform:uppercase; color:var(--ink-faint);
  border:1px solid var(--rule); border-radius:4px; padding:1px 6px; margin-left:8px; vertical-align:2px;
}
@media (prefers-reduced-motion:reduce){ *{animation:none !important; transition:none !important} }
@media (max-width:640px){
  .hero{padding:36px 0 20px}
  .stats{gap:22px}
  .stat b{font-size:32px}
  .yearrow{grid-template-columns:52px 1fr}
}
`;

const JS = String.raw`
const S = JSON.parse(document.getElementById("state").textContent);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthYear = iso => MON[+iso.slice(5,7)-1] + " " + iso.slice(0,4);
const dayMonth = iso => +iso.slice(8,10) + " " + MON[+iso.slice(5,7)-1];

let picked = null;   // a country name, or a year, or null

/* ---------- the map ---------- */
const F = S.frame;
const W = 1000;
const H = Math.round(W * (F.north - F.south) / (F.east - F.west));
const px = lon => (lon - F.west) / (F.east - F.west) * W;
const py = lat => (F.north - lat) / (F.north - F.south) * H;

function drawMap(){
  const paths = S.land.map(ring => {
    let d = "";
    for (let i = 0; i < ring.length; i++){
      d += (i ? "L" : "M") + px(ring[i][0]).toFixed(1) + " " + py(ring[i][1]).toFixed(1);
    }
    return '<path class="land" d="' + d + 'Z"/>';
  }).join("");

  // faint lines from home to each country, so Dubai reads as the hub
  const routes = S.dots.map(d =>
    '<path class="route" d="M' + px(S.home.lon).toFixed(1) + ' ' + py(S.home.lat).toFixed(1) +
    'L' + px(d.lon).toFixed(1) + ' ' + py(d.lat).toFixed(1) + '"/>'
  ).join("");

  const home =
    '<g class="home">' +
      '<circle cx="' + px(S.home.lon).toFixed(1) + '" cy="' + py(S.home.lat).toFixed(1) + '" r="9"/>' +
      '<circle cx="' + px(S.home.lon).toFixed(1) + '" cy="' + py(S.home.lat).toFixed(1) + '" r="2.5" style="fill:var(--ink-faint)"/>' +
      '<text x="' + px(S.home.lon).toFixed(1) + '" y="' + (py(S.home.lat) + 22).toFixed(1) + '" text-anchor="middle">DUBAI</text>' +
    '</g>';

  /**
   * Europe is a pile-up at this scale, so the labels have to be moved off the
   * dots or they sit on top of each other. Each label keeps its side, then gets
   * pushed down until it clears the one above it, and a hairline joins it back
   * to its dot so you can still tell which is which.
   */
  const LINE_H = 12;
  const placed = S.dots.map(d => {
    const x = px(d.lon), y = py(d.lat);
    return { d, x, y, r: 5 + Math.min(d.visits, 4) * 2.2, right: x < W * 0.72, ly: y };
  });
  for (const side of [true, false]) {
    const col = placed.filter(p => p.right === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      const gap = col[i].ly - col[i - 1].ly;
      if (gap < LINE_H) col[i].ly = col[i - 1].ly + LINE_H;
    }
  }

  // Circles first, then every label, so a neighbouring dot never lands on top
  // of somebody's country name.
  const circles = placed.map((p, i) =>
    '<g class="dot" data-country="' + esc(p.d.country) + '" style="animation-delay:' + (i * 45) + 'ms">' +
      '<circle class="halo" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (p.r + 9).toFixed(1) + '"/>' +
      '<circle class="core" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + p.r.toFixed(1) + '"/>' +
    '</g>'
  ).join("");

  const labels = placed.map((p, i) => {
    const { d, x, y, r, right } = p;
    const lx = right ? x + r + 7 : x - r - 7;
    const leader = Math.abs(p.ly - y) > 2.5
      ? '<path class="leader" d="M' + (right ? x + r + 1.5 : x - r - 1.5).toFixed(1) + ' ' + y.toFixed(1) +
        'L' + lx.toFixed(1) + ' ' + p.ly.toFixed(1) + '"/>'
      : '';
    return '<g class="dot label" data-country="' + esc(d.country) + '" tabindex="0" role="button" ' +
      'aria-label="' + esc(d.country) + ', ' + d.visits + (d.visits === 1 ? ' trip' : ' trips') + '" ' +
      'style="animation-delay:' + (i * 45) + 'ms">' + leader +
      '<text x="' + lx.toFixed(1) + '" y="' + (p.ly + 3.2).toFixed(1) + '"' +
        (right ? '' : ' text-anchor="end"') + '>' + esc(d.country.toUpperCase()) +
        (d.visits > 1 ? ' ×' + d.visits : '') + '</text>' +
    '</g>';
  }).join("");

  document.getElementById("map").innerHTML =
    '<svg class="map" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="Map of the ' + S.stats.countries + ' countries Aastha has travelled to from Dubai">' +
      paths + routes + home + circles + labels +
    '</svg>';
}

/* ---------- the year rhythm ---------- */
function drawRhythm(){
  document.getElementById("rhythm-rows").innerHTML = S.yearList.slice().reverse().map(y => {
    const ids = S.years[y];
    const pips = ids.map(id => {
      const t = S.trips.find(x => x.id === id);
      const img = t.posts.find(p => p.img);
      return '<button class="pip' + (picked === id ? ' on' : '') + '" data-trip="' + esc(id) + '" ' +
        'title="' + esc(t.countries.join(" then ")) + ', ' + monthYear(t.start) + '">' +
        (img ? '<img src="' + img.img + '" alt="">' : '') + '</button>';
    }).join("");
    return '<div class="yearrow"><span class="yr">' + y + '</span><div class="pips">' + pips + '</div></div>';
  }).join("");
}

/* ---------- the trips ---------- */
function visible(){
  if (!picked) return S.trips;
  if (typeof picked === "number") return S.trips.filter(t => t.year === picked);
  if (S.trips.some(t => t.id === picked)) return S.trips.filter(t => t.id === picked);
  return S.trips.filter(t => t.countries.includes(picked));
}

function tripCard(t){
  const shots = t.posts.filter(p => p.img);
  const cover = shots[0];
  const rest = shots.slice(1);
  const coverHTML = cover
    ? '<a href="' + esc(cover.link) + '" target="_blank" rel="noopener">' +
        '<img class="cover" src="' + cover.img + '" alt="' + esc(t.countries.join(", ")) + '"' +
        (cover.w && cover.h ? ' width="' + cover.w + '" height="' + cover.h + '"' : '') + '>' +
      '</a>'
    : '<div class="cover-none">' + (t.byHand ? "She went. She just never posted it." : "No photo saved") + '</div>';
  const moreHTML = rest.length
    ? '<div class="more">' + rest.map(p =>
        '<a href="' + esc(p.link) + '" target="_blank" rel="noopener" title="' + dayMonth(p.date) + '">' +
        '<img src="' + p.img + '" alt=""></a>').join("") + '</div>'
    : '';
  const best = t.posts.slice().sort((a,b) => (b.views||b.likes||0) - (a.views||a.likes||0))[0];
  // Only list the posts that have no picture of their own up top, so the same
  // post is not offered twice on one card.
  const shownLinks = new Set(shots.map(p => p.link));
  const links = t.posts.filter(p => !shownLinks.has(p.link)).slice(0, 6).map(p =>
    '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + dayMonth(p.date) + '</a>'
  ).join("");
  const when = (t.monthOnly || t.start === t.end) ? monthYear(t.start)
    : (t.start.slice(0,7) === t.end.slice(0,7) ? dayMonth(t.start) + " to " + dayMonth(t.end) + " " + t.end.slice(0,4)
       : monthYear(t.start) + " to " + monthYear(t.end));

  return '<article class="trip' + (picked === t.id ? ' lit' : '') + '" id="t-' + esc(t.id) + '">' +
    coverHTML + moreHTML +
    '<div class="trip-b">' +
      '<h3 class="route-line">' + t.countries.map(esc).join(" <span style=\"color:var(--ink-faint)\">→</span> ") + '</h3>' +
      '<p class="trip-when">' + when + ' &middot; ' + t.posts.length + (t.posts.length === 1 ? ' post' : ' posts') + '</p>' +
      (best ? '<p class="trip-cap">' + esc(best.caption) + '</p>' : '') +
      (links ? '<div class="trip-links">' + links + '</div>' : '') +
    '</div>' +
  '</article>';
}

function drawTrips(){
  const list = visible();
  document.getElementById("grid").innerHTML = list.map(tripCard).join("");
  const label = document.getElementById("showing");
  label.textContent = picked === null
    ? "Every trip"
    : (typeof picked === "number" ? picked + ": " + list.length + (list.length === 1 ? " trip" : " trips")
       : list.length + (list.length === 1 ? " trip" : " trips") + (S.trips.some(t => t.id === picked) ? "" : " through " + picked));
  document.getElementById("clear").hidden = picked === null;
  for (const g of document.querySelectorAll(".dot")) {
    g.classList.toggle("on", g.dataset.country === picked);
  }
  for (const b of document.querySelectorAll(".pip")) {
    b.classList.toggle("on", b.dataset.trip === picked);
  }
  for (const b of document.querySelectorAll(".pill[data-year]")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.year) === picked));
  }
}

function pick(v, scroll){
  picked = (picked === v) ? null : v;
  drawTrips();
  if (scroll && picked !== null) {
    document.getElementById("trips").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }
}

drawMap();
drawRhythm();
drawTrips();

document.getElementById("map").addEventListener("click", e => {
  const g = e.target.closest(".dot");
  if (g) pick(g.dataset.country, true);
});
document.getElementById("map").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const g = e.target.closest(".dot");
  if (g) { e.preventDefault(); pick(g.dataset.country, true); }
});
document.getElementById("rhythm-rows").addEventListener("click", e => {
  const b = e.target.closest(".pip");
  if (b) pick(b.dataset.trip, true);
});
document.getElementById("filters").addEventListener("click", e => {
  const b = e.target.closest(".pill");
  if (!b) return;
  if (b.id === "clear") { picked = null; drawTrips(); return; }
  pick(Number(b.dataset.year), false);
});

/* ---------- adding a trip she never posted about ----------
   Only somebody with editing rights can save. Anyone who can merely look is
   turned away by the platform itself, not by hiding a button, and the first
   time that happens the control disappears for good on that view. */
const openBtn = document.getElementById("a-open");
const panel = document.getElementById("adder");
const msg = document.getElementById("a-msg");
const countrySel = document.getElementById("a-country");
const secondSel = document.getElementById("a-second");

for (const [name] of Object.entries(S.places)) {
  countrySel.insertAdjacentHTML("beforeend", '<option>' + esc(name) + '</option>');
}
secondSel.insertAdjacentHTML("afterbegin", '<option value="">Nowhere else</option>');
for (const [name] of Object.entries(S.places)) {
  secondSel.insertAdjacentHTML("beforeend", '<option>' + esc(name) + '</option>');
}

function say(text, bad){ msg.textContent = text; msg.classList.toggle("bad", !!bad); }
function hideAdder(reason){
  panel.hidden = true;
  openBtn.remove();
  if (reason) console.info(reason);
}

openBtn.addEventListener("click", () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) { say(""); panel.scrollIntoView({ block: "nearest" }); countrySel.focus(); }
});
document.getElementById("a-cancel").addEventListener("click", () => { panel.hidden = true; });

function rebuildDots(){
  const dots = {};
  for (const t of S.trips) {
    for (const s of t.stops) {
      const d = (dots[s.country] ||= { country: s.country, lat: s.lat, lon: s.lon, visits: 0, tripIds: [] });
      if (!d.tripIds.includes(t.id)) { d.visits++; d.tripIds.push(t.id); }
    }
  }
  S.dots = Object.values(dots).sort((a,b) => b.visits - a.visits);
  S.years = {};
  for (const t of S.trips) (S.years[t.year] ||= []).push(t.id);
  S.yearList = Object.keys(S.years).map(Number).sort();
  S.stats.journeys = S.trips.length;
  S.stats.countries = S.dots.length;
  S.stats.posts = S.trips.reduce((n,t) => n + t.posts.length, 0);
  S.stats.firstYear = S.yearList[0];
  S.stats.lastYear = S.yearList[S.yearList.length - 1];
  const b = [...document.querySelectorAll(".stat b")];
  if (b.length === 4) {
    b[0].textContent = S.stats.countries;
    b[1].textContent = S.stats.journeys;
    b[2].textContent = S.stats.posts;
    b[3].textContent = S.stats.lastYear - S.stats.firstYear + 1;
  }
}

function wholePage(){
  const css = document.getElementById("css").textContent;
  const js = document.getElementById("code").textContent;
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>Aastha's Travel Map</title>\n" + FONTS + "\n" +
    "<style id=\"css\">" + css + "</style>\n</head>\n<body>\n" +
    SHELL + "\n" +
    "<script id=\"state\" type=\"application/json\">" + JSON.stringify(S).replace(/<\//g, "<\\/") + "<\/script>\n" +
    "<script id=\"code\">" + js + "<\/script>\n</body>\n</html>";
}

document.getElementById("a-save").addEventListener("click", async () => {
  const btn = document.getElementById("a-save");
  const first = countrySel.value;
  const second = secondSel.value;
  const start = document.getElementById("a-start").value;
  const end = document.getElementById("a-end").value || start;
  const links = document.getElementById("a-links").value
    .split("\n").map(s => s.trim()).filter(s => /^https?:\/\/(www\.)?instagram\.com\//i.test(s));

  if (!first) return say("Pick a country first.", true);
  if (!start) return say("Put in the day she went out.", true);
  if (end < start) return say("She cannot come home before she leaves. Check the dates.", true);

  const countries = second && second !== first ? [first, second] : [first];
  const id = start + "-" + countries.join("-").toLowerCase().replace(/[^a-z-]/g, "") + "-added";
  if (S.trips.some(t => t.id === id)) return say("That trip is already on the map.", true);

  const trip = {
    id,
    countries,
    stops: countries.map(c => ({ country: c, lat: S.places[c][0], lon: S.places[c][1] })),
    start, end,
    year: Number(start.slice(0, 4)),
    byHand: true,
    monthOnly: false,
    addedOnPage: true,
    postLinks: links,
    posts: links.map(l => ({ date: start, link: l, caption: "", views: null, likes: 0, img: null, w: null, h: null })),
  };

  S.trips.push(trip);
  S.trips.sort((a, b) => b.start.localeCompare(a.start));
  rebuildDots();
  drawMap(); drawRhythm(); drawTrips();

  btn.disabled = true;
  say("Saving...");
  // Opened straight off a disk or any other host, there is nothing to save to.
  const api = (typeof claude === "object" && claude && claude.use)
    ? await claude.use("artifact")
    : null;
  if (!api) {
    btn.disabled = false;
    say("Saving is not available on this view. The trip is showing here but will not stick.", true);
    return;
  }
  try {
    await api.publish(wholePage());   // this view reloads to the saved copy
  } catch (err) {
    btn.disabled = false;
    const code = err && err.code;
    if (code === "conflict") return;  // someone saved first, the page reloads to theirs
    if (code === "not_writer" || code === "not_granted" || code === "not_declared" || code === "capability_disabled") {
      S.trips = S.trips.filter(t => t.id !== id);
      rebuildDots(); drawMap(); drawRhythm(); drawTrips();
      hideAdder("This view can look but not change the map.");
      return;
    }
    say("That did not save. Try once more.", true);
  }
});
`;

const s = state.stats;
const SHELL = `<div class="wrap">
  <section class="hero">
    <p class="eyebrow">Aastha Chopra &middot; Dubai &middot; Licensed creator 1557678</p>
    <h1>Always just back, or <em>just about to go</em>.</h1>
    <p class="lede">${s.countries} countries since ${s.firstYear}, fitted around a working life and kids at home. Every trip below is one she actually took and actually posted. Tap a country, a year, or any photo.</p>
    <div class="stats">
      <div class="stat"><b>${s.countries}</b><span>Countries</span></div>
      <div class="stat"><b>${s.journeys}</b><span>Trips</span></div>
      <div class="stat"><b>${s.posts}</b><span>Posts from the road</span></div>
      <div class="stat"><b>${s.lastYear - s.firstYear + 1}</b><span>Years running</span></div>
    </div>
  </section>

  <div class="mapwrap">
    <div id="map"></div>
    <div class="legend">
      <span>Dubai is home. Every line is a trip out and back.</span>
      <span>Bigger dot, more visits.</span>
    </div>
  </div>

  <section class="rhythm">
    <h2>It does not let up</h2>
    <p class="section-note">Each square is one trip. Some years are quieter, some are relentless. None of them are empty.</p>
    <div id="rhythm-rows"></div>
  </section>

  <section class="trips" id="trips">
    <h2>The trips</h2>
    <div class="filterbar" id="filters">
      <span class="section-note" id="showing" style="margin:0 10px 0 0"></span>
      ${state.yearList.slice().reverse().map(y => `<button class="pill" data-year="${y}">${y}</button>`).join('\n      ')}
      <button class="pill" id="clear" hidden>Show all</button>
    </div>
    <div class="grid" id="grid"></div>
  </section>

  <section id="adder" hidden>
    <div class="adder-form">
      <h3>Add a trip</h3>
      <p class="hint">For trips that never made it into a caption. Vietnam was one. It appears on the map straight away.</p>
      <div class="field">
        <label for="a-country">Country</label>
        <select id="a-country"></select>
      </div>
      <div class="field" id="a-second-wrap">
        <label for="a-second">And then (optional)</label>
        <select id="a-second"></select>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="a-start">Went out</label>
          <input type="date" id="a-start">
        </div>
        <div class="field">
          <label for="a-end">Came home</label>
          <input type="date" id="a-end">
        </div>
      </div>
      <div class="field">
        <label for="a-links">Posts from the trip (optional, one link per line)</label>
        <textarea id="a-links" placeholder="https://www.instagram.com/reel/..."></textarea>
      </div>
      <div class="adder-actions">
        <button class="btn" id="a-save">Add to the map</button>
        <button class="btn quiet" id="a-cancel">Cancel</button>
      </div>
      <p class="adder-msg" id="a-msg"></p>
    </div>
  </section>

  <footer>
    Built from Aastha's own Instagram archive. Only trips she has confirmed appear here.
    Local trips around the UAE are not on the map.
    <button class="adder-open" id="a-open">Add a trip</button>
  </footer>
</div>`;

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;1,400&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">';

// The page has to be able to write itself out again when Aastha adds a trip,
// so it carries its own shell and font lines as text.
const scripts = `<script id="state" type="application/json">${JSON.stringify(state).replace(/<\//g, '<\\/')}</script>
<script id="code">const FONTS = ${JSON.stringify(FONTS)};
const SHELL = ${JSON.stringify(SHELL)};
${JS}</script>`;

const body = `<title>Aastha's Travel Map</title>
${FONTS}
<style id="css">${CSS}</style>
${SHELL}
${scripts}`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aastha's Travel Map</title>
${FONTS}
<style id="css">${CSS}</style>
</head>
<body>
${SHELL}
${scripts}
</body>
</html>`;

mkdirSync(resolve(__dirname, '../build'), { recursive: true });
writeFileSync(resolve(__dirname, '../build/travel-map-artifact.html'), body);
writeFileSync(resolve(__dirname, '../build/travel-map.html'), standalone);
console.log(`${trips.length} journeys, ${s.countries} countries, ${s.posts} posts, ${land.length} land shapes.`);
console.log(`${(body.length / 1048576).toFixed(2)} MB → build/travel-map-artifact.html`);
