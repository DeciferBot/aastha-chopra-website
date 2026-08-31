/**
 * Travel page for her own website → travel.html
 * -----------------------------------------------------------------------------
 * The same map as the private one, rebuilt to live on aasthachopra.com so that
 * anyone can open it. Three differences that matter:
 *
 *   1. Her house look. Near black and gold, Cormorant and Jost, the shared
 *      css/world.css, the same top and bottom of every other world page.
 *   2. Pictures load from their real address instead of being carried inside
 *      the page. On her own site there is no size limit to work around, so the
 *      page stays light and the photographs stay sharp.
 *   3. No way to add a trip. Adding stays on the private copy, where only
 *      Aastha can reach it.
 *
 * Run scripts/build-travel-map.mjs first, since this reads what that produced.
 *
 * Usage:
 *   node scripts/build-travel-page.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(readFileSync(resolve(__dirname, '..', f), 'utf8'));

const SITE = 'https://www.aasthachopra.com';

// Read the finished private map and reuse exactly what it decided.
const mapHtml = readFileSync(resolve(__dirname, '../build/travel-map.html'), 'utf8');
const state = JSON.parse(
  mapHtml.match(/<script id="state" type="application\/json">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</')
);

// Swap the carried-in pictures for their real addresses.
const candidates = read('data/travel-candidates.json');
const photoByLink = {};
for (const t of candidates.trips) {
  for (const p of t.posts) if (p.thumbnail) photoByLink[p.permalink] = p.thumbnail;
}
try {
  for (const p of read('data/travel-manual-posts.json')) {
    if (p.thumbnail) photoByLink[p.permalink] = p.thumbnail;
  }
} catch { /* none */ }

let missing = 0;
for (const t of state.trips) {
  for (const p of t.posts) {
    const real = photoByLink[p.link];
    if (p.img && !real) missing++;
    p.img = real || null;
  }
}
if (missing) console.log(`${missing} post(s) had no picture address and will show without one.`);

delete state.places;   // the picker is not on this page

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* --------------------------- the page's own look --------------------------- */

const CSS = `
/* The map, dressed in the house palette from css/world.css */
.tm-wrap{max-width:1180px; margin:0 auto; padding:0 clamp(20px,5vw,60px)}
.tm-intro{padding:clamp(60px,9vw,110px) 0 0; max-width:760px}
.tm-eyebrow{
  font-family:'Jost',sans-serif; font-size:11px; letter-spacing:.28em; text-transform:uppercase;
  color:var(--gold); margin:0 0 20px;
}
.tm-intro h1{
  font-family:'Cormorant Garamond',serif; font-weight:300; font-size:clamp(38px,6.4vw,74px);
  line-height:1.04; margin:0; color:var(--text, #F2EDE4); letter-spacing:-.01em;
}
.tm-intro h1 em{font-style:italic; color:var(--gold-light)}
.tm-lede{
  font-family:'Jost',sans-serif; font-weight:300; font-size:clamp(15px,1.6vw,18px);
  line-height:1.72; color:var(--text-dim,#B8AE9E); margin:22px 0 0; max-width:56ch;
}
.tm-stats{
  display:flex; flex-wrap:wrap; gap:clamp(26px,5vw,60px); margin:40px 0 0;
  padding-top:30px; border-top:1px solid var(--gold-dim);
}
.tm-stat b{
  display:block; font-family:'Cormorant Garamond',serif; font-weight:300; font-size:clamp(34px,4.6vw,52px);
  line-height:1; color:var(--gold-light); font-variant-numeric:tabular-nums;
}
.tm-stat span{
  display:block; font-family:'Jost',sans-serif; font-size:10px; letter-spacing:.2em;
  text-transform:uppercase; color:var(--text-dim,#B8AE9E); margin-top:11px;
}

.tm-mapbox{
  margin:clamp(38px,6vw,64px) 0 0; border:1px solid var(--gold-dim); border-radius:4px;
  background:var(--bg-raised,#0f0d0b); overflow:hidden;
}
svg.tm-map{display:block; width:100%; height:auto}
.tm-map .land{fill:#191512; stroke:none}
.tm-map .route{stroke:var(--gold-mid); stroke-width:1; fill:none; opacity:.5; stroke-dasharray:4 5}
.tm-map .dot{cursor:pointer}
.tm-map .halo{fill:var(--gold); opacity:.16}
.tm-map .core{fill:var(--gold); stroke:#0f0d0b; stroke-width:1.6}
.tm-map .leader{stroke:var(--gold-mid); stroke-width:.8; fill:none}
.tm-map text{
  font-family:'Jost',sans-serif; font-size:9px; font-weight:400; letter-spacing:.12em;
  fill:#F2EDE4; paint-order:stroke; stroke:#0f0d0b; stroke-width:3px; stroke-linejoin:round;
}
.tm-map .dot.on .halo{opacity:.4}
.tm-map .home circle{fill:none; stroke:var(--gold-mid); stroke-width:1.4}
.tm-map .home text{font-size:8px; fill:var(--gold-light); letter-spacing:.22em}
.tm-legend{
  display:flex; gap:20px; flex-wrap:wrap; padding:13px 20px; border-top:1px solid var(--gold-dim);
  font-family:'Jost',sans-serif; font-size:11px; letter-spacing:.13em; text-transform:uppercase;
  color:var(--text-dim,#B8AE9E);
}

.tm-section{margin:clamp(52px,7vw,92px) 0 0}
.tm-section h2{
  font-family:'Cormorant Garamond',serif; font-weight:300; font-size:clamp(28px,3.6vw,44px);
  margin:0 0 8px; color:#F2EDE4;
}
.tm-note{
  font-family:'Jost',sans-serif; font-weight:300; font-size:15px; line-height:1.7;
  color:var(--text-dim,#B8AE9E); margin:0 0 26px; max-width:58ch;
}
.tm-year{
  display:grid; grid-template-columns:72px 1fr; gap:18px; align-items:center;
  padding:12px 0; border-top:1px solid var(--gold-dim);
}
.tm-year:last-child{border-bottom:1px solid var(--gold-dim)}
.tm-yr{font-family:'Jost',sans-serif; font-size:14px; letter-spacing:.16em; color:var(--gold-light)}
.tm-pips{display:flex; gap:7px; flex-wrap:wrap}
.tm-pip{
  width:34px; height:34px; border-radius:2px; border:1px solid var(--gold-dim);
  background:var(--bg-card,#131109); cursor:pointer; padding:0; overflow:hidden;
}
.tm-pip img{width:100%; height:100%; object-fit:cover; display:block}
.tm-pip.on{border-color:var(--gold); box-shadow:0 0 0 2px var(--gold-dim)}

.tm-filters{display:flex; gap:9px; flex-wrap:wrap; align-items:center; margin:0 0 26px}
.tm-pill{
  font-family:'Jost',sans-serif; font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  padding:6px 15px; border-radius:2px; cursor:pointer; background:transparent;
  color:var(--text-dim,#B8AE9E); border:1px solid var(--gold-dim);
}
.tm-pill[aria-pressed="true"]{background:var(--gold); color:#0a0a0a; border-color:var(--gold)}
.tm-showing{
  font-family:'Jost',sans-serif; font-size:13px; color:var(--text-dim,#B8AE9E);
  margin:0 12px 0 0; letter-spacing:.04em;
}

.tm-grid{columns:3 300px; column-gap:20px}
@media (max-width:1000px){ .tm-grid{columns:2 280px} }
@media (max-width:620px){ .tm-grid{columns:1} }
.tm-trip{
  background:var(--bg-card,#131109); border:1px solid var(--gold-dim); border-radius:3px;
  overflow:hidden; break-inside:avoid; margin:0 0 20px; display:inline-block; width:100%;
}
.tm-trip.lit{border-color:var(--gold-hi)}
.tm-cover{display:block; width:100%; height:auto; background:var(--bg-overlay,#1a1712)}
.tm-cover-none{
  padding:30px 18px; text-align:center; background:var(--bg-overlay,#1a1712);
  font-family:'Jost',sans-serif; font-size:13px; color:var(--text-dim,#B8AE9E);
}
.tm-more{display:flex; gap:7px; flex-wrap:wrap; padding:14px 18px 0}
.tm-more a{width:54px; height:54px; border-radius:2px; overflow:hidden; display:block; border:1px solid var(--gold-dim)}
.tm-more a img{width:100%; height:100%; object-fit:cover; display:block}
.tm-more a:hover{border-color:var(--gold-hi)}
.tm-body{padding:16px 18px 18px}
.tm-route{font-family:'Cormorant Garamond',serif; font-weight:300; font-size:26px; line-height:1.16; margin:0; color:#F2EDE4}
.tm-when{
  font-family:'Jost',sans-serif; font-size:11px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--gold-light); margin:7px 0 0;
}
.tm-cap{font-family:'Jost',sans-serif; font-weight:300; font-size:14px; line-height:1.68; color:var(--text-dim,#B8AE9E); margin:13px 0 0}
.tm-links{display:flex; gap:8px; flex-wrap:wrap; margin:14px 0 0}
.tm-links a{
  font-family:'Jost',sans-serif; font-size:10px; letter-spacing:.16em; text-transform:uppercase;
  text-decoration:none; color:var(--gold-light); border:1px solid var(--gold-dim);
  border-radius:2px; padding:4px 10px;
}
.tm-links a:hover{border-color:var(--gold-hi)}
.tm-foot{
  margin:clamp(48px,6vw,80px) 0 0; padding:26px 0 clamp(60px,8vw,100px);
  border-top:1px solid var(--gold-dim); font-family:'Jost',sans-serif; font-weight:300;
  font-size:13px; line-height:1.7; color:var(--text-dim,#B8AE9E); max-width:62ch;
}
@media (prefers-reduced-motion:reduce){ *{animation:none!important; transition:none!important} }
`;

const JS = String.raw`
(function(){
const S = JSON.parse(document.getElementById("tm-state").textContent);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthYear = iso => MON[+iso.slice(5,7)-1] + " " + iso.slice(0,4);
const dayMonth = iso => +iso.slice(8,10) + " " + MON[+iso.slice(5,7)-1];
let picked = null;

const F = S.frame, W = 1000;
const H = Math.round(W * (F.north - F.south) / (F.east - F.west));
const px = lon => (lon - F.west) / (F.east - F.west) * W;
const py = lat => (F.north - lat) / (F.north - F.south) * H;

function drawMap(){
  const paths = S.land.map(ring => {
    let d = "";
    for (let i = 0; i < ring.length; i++) d += (i?"L":"M") + px(ring[i][0]).toFixed(1) + " " + py(ring[i][1]).toFixed(1);
    return '<path class="land" d="' + d + 'Z"/>';
  }).join("");
  const routes = S.dots.map(d =>
    '<path class="route" d="M' + px(S.home.lon).toFixed(1) + ' ' + py(S.home.lat).toFixed(1) +
    'L' + px(d.lon).toFixed(1) + ' ' + py(d.lat).toFixed(1) + '"/>').join("");
  const home = '<g class="home">' +
    '<circle cx="' + px(S.home.lon).toFixed(1) + '" cy="' + py(S.home.lat).toFixed(1) + '" r="9"/>' +
    '<circle cx="' + px(S.home.lon).toFixed(1) + '" cy="' + py(S.home.lat).toFixed(1) + '" r="2.5" style="fill:var(--gold-light)"/>' +
    '<text x="' + px(S.home.lon).toFixed(1) + '" y="' + (py(S.home.lat)+22).toFixed(1) + '" text-anchor="middle">DUBAI</text></g>';

  const LINE_H = 12;
  const placed = S.dots.map(d => {
    const x = px(d.lon), y = py(d.lat);
    return { d, x, y, r: 5 + Math.min(d.visits,4)*2.2, right: x < W*0.72, ly: y };
  });
  for (const side of [true,false]) {
    const col = placed.filter(p => p.right === side).sort((a,b)=>a.y-b.y);
    for (let i=1;i<col.length;i++) if (col[i].ly - col[i-1].ly < LINE_H) col[i].ly = col[i-1].ly + LINE_H;
  }
  const circles = placed.map(p =>
    '<g class="dot" data-country="' + esc(p.d.country) + '">' +
    '<circle class="halo" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(p.r+9).toFixed(1)+'"/>' +
    '<circle class="core" cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+p.r.toFixed(1)+'"/></g>').join("");
  const labels = placed.map(p => {
    const lx = p.right ? p.x + p.r + 7 : p.x - p.r - 7;
    const leader = Math.abs(p.ly - p.y) > 2.5
      ? '<path class="leader" d="M'+(p.right?p.x+p.r+1.5:p.x-p.r-1.5).toFixed(1)+' '+p.y.toFixed(1)+'L'+lx.toFixed(1)+' '+p.ly.toFixed(1)+'"/>' : '';
    return '<g class="dot" data-country="'+esc(p.d.country)+'" tabindex="0" role="button" aria-label="'+esc(p.d.country)+', '+p.d.visits+(p.d.visits===1?' trip':' trips')+'">'+leader+
      '<text x="'+lx.toFixed(1)+'" y="'+(p.ly+3.2).toFixed(1)+'"'+(p.right?'':' text-anchor="end"')+'>'+
      esc(p.d.country.toUpperCase())+(p.d.visits>1?' ×'+p.d.visits:'')+'</text></g>';
  }).join("");

  document.getElementById("tm-mapholder").innerHTML =
    '<svg class="tm-map" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Map of the '+S.stats.countries+' countries Aastha has travelled to from Dubai">' +
    paths + routes + home + circles + labels + '</svg>';
}

function drawRhythm(){
  document.getElementById("tm-years").innerHTML = S.yearList.slice().reverse().map(y => {
    const pips = S.years[y].map(id => {
      const t = S.trips.find(x => x.id === id);
      const img = t.posts.find(p => p.img);
      return '<button class="tm-pip'+(picked===id?' on':'')+'" data-trip="'+esc(id)+'" title="'+esc(t.countries.join(" then "))+', '+monthYear(t.start)+'">'+
        (img?'<img src="'+esc(img.img)+'" alt="" loading="lazy">':'')+'</button>';
    }).join("");
    return '<div class="tm-year"><span class="tm-yr">'+y+'</span><div class="tm-pips">'+pips+'</div></div>';
  }).join("");
}

function visible(){
  if (!picked) return S.trips;
  if (typeof picked === "number") return S.trips.filter(t => t.year === picked);
  if (S.trips.some(t => t.id === picked)) return S.trips.filter(t => t.id === picked);
  return S.trips.filter(t => t.countries.includes(picked));
}

function card(t){
  const shots = t.posts.filter(p => p.img);
  const cover = shots[0], rest = shots.slice(1);
  const coverHTML = cover
    ? '<a href="'+esc(cover.link)+'" target="_blank" rel="noopener"><img class="tm-cover" src="'+esc(cover.img)+'" alt="'+esc(t.countries.join(", "))+'" loading="lazy"'+
      (cover.w&&cover.h?' width="'+cover.w+'" height="'+cover.h+'"':'')+'></a>'
    : '<div class="tm-cover-none">'+(t.byHand?"She went. She just never posted it.":"No photo saved")+'</div>';
  const moreHTML = rest.length
    ? '<div class="tm-more">'+rest.map(p=>'<a href="'+esc(p.link)+'" target="_blank" rel="noopener" title="'+dayMonth(p.date)+'"><img src="'+esc(p.img)+'" alt="" loading="lazy"></a>').join("")+'</div>' : '';
  const best = t.posts.slice().sort((a,b)=>(b.views||b.likes||0)-(a.views||a.likes||0))[0];
  const shown = new Set(shots.map(p=>p.link));
  const links = t.posts.filter(p=>!shown.has(p.link)).slice(0,6)
    .map(p=>'<a href="'+esc(p.link)+'" target="_blank" rel="noopener">'+dayMonth(p.date)+'</a>').join("");
  const when = (t.monthOnly || t.start === t.end) ? monthYear(t.start)
    : (t.start.slice(0,7)===t.end.slice(0,7)
        ? dayMonth(t.start)+" to "+dayMonth(t.end)+" "+t.end.slice(0,4)
        : monthYear(t.start)+" to "+monthYear(t.end));
  return '<article class="tm-trip'+(picked===t.id?' lit':'')+'">'+coverHTML+moreHTML+
    '<div class="tm-body"><h3 class="tm-route">'+t.countries.map(esc).join(' <span style="color:var(--gold-mid)">&rarr;</span> ')+'</h3>'+
    '<p class="tm-when">'+when+' &middot; '+t.posts.length+(t.posts.length===1?' post':' posts')+'</p>'+
    (best&&best.caption?'<p class="tm-cap">'+esc(best.caption)+'</p>':'')+
    (links?'<div class="tm-links">'+links+'</div>':'')+'</div></article>';
}

function drawTrips(){
  const list = visible();
  document.getElementById("tm-grid").innerHTML = list.map(card).join("");
  document.getElementById("tm-showing").textContent = picked === null
    ? "Every trip"
    : (typeof picked === "number"
        ? picked + ": " + list.length + (list.length===1?" trip":" trips")
        : list.length + (list.length===1?" trip":" trips") + (S.trips.some(t=>t.id===picked)?"":" through "+picked));
  document.getElementById("tm-clear").hidden = picked === null;
  for (const g of document.querySelectorAll(".tm-map .dot")) g.classList.toggle("on", g.dataset.country === picked);
  for (const b of document.querySelectorAll(".tm-pip")) b.classList.toggle("on", b.dataset.trip === picked);
  for (const b of document.querySelectorAll(".tm-pill[data-year]")) b.setAttribute("aria-pressed", String(Number(b.dataset.year) === picked));
}

function pick(v, scroll){
  picked = (picked === v) ? null : v;
  drawTrips();
  if (scroll && picked !== null) document.getElementById("tm-trips").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

drawMap(); drawRhythm(); drawTrips();
document.getElementById("tm-mapholder").addEventListener("click", e => {
  const g = e.target.closest(".dot"); if (g) pick(g.dataset.country, true);
});
document.getElementById("tm-mapholder").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const g = e.target.closest(".dot"); if (g) { e.preventDefault(); pick(g.dataset.country, true); }
});
document.getElementById("tm-years").addEventListener("click", e => {
  const b = e.target.closest(".tm-pip"); if (b) pick(b.dataset.trip, true);
});
document.getElementById("tm-filters").addEventListener("click", e => {
  const b = e.target.closest(".tm-pill"); if (!b) return;
  if (b.id === "tm-clear") { picked = null; drawTrips(); return; }
  pick(Number(b.dataset.year), false);
});
})();
`;

const s = state.stats;
const NAV = `  <nav class="world-nav">
    <a href="index.html" class="world-nav-logo">Aastha Chopra</a>
    <button class="world-nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="world-nav-links">
      <svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
      <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
    </button>
    <ul class="world-nav-links" id="world-nav-links">
      <li><a href="index.html#brand-fit">All Worlds</a></li>
      <li><a href="fashion.html">Fashion</a></li>
      <li><a href="luxury.html">Luxury</a></li>
      <li><a href="wellness.html">Wellness</a></li>
      <li><span class="active">Travel</span></li>
      <li><a href="/blog">Journal</a></li>
      <li><a class="nav-cta-mobile" href="mailto:management@aasthachopra.com">Collaborate</a></li>
    </ul>
    <a href="mailto:management@aasthachopra.com" class="world-nav-cta">Collaborate</a>
  </nav>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <script>document.documentElement.className += ' js';</script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Travel Map — Aastha Chopra | ${s.countries} Countries From Dubai</title>
  <meta name="description" content="Every trip Aastha Chopra has actually taken since ${s.firstYear}, ${s.countries} countries out of Dubai, each one with the posts behind it. A Dubai creator who is always just back or just about to go." />

  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-MNSRF3MYFY"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-MNSRF3MYFY');
  </script>

  <link rel="canonical" href="${SITE}/travel.html" />
  <meta name="keywords" content="travel creator Dubai, travel influencer UAE, hotel partnerships Dubai, luxury travel creator, Aastha Chopra travel" />

  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <meta name="theme-color" content="#0a0a0a" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="${SITE}/travel.html" />
  <meta property="og:title" content="Travel Map — Aastha Chopra | ${s.countries} Countries From Dubai" />
  <meta property="og:description" content="${s.journeys} trips across ${s.countries} countries since ${s.firstYear}, fitted around a working life and kids at home." />
  <meta property="og:image" content="${SITE}/images/aastha-chopra-dubai-luxury-travel-hero.jpg" />
  <meta property="og:image:alt" content="Aastha Chopra — Dubai Luxury and Travel Creator" />
  <meta property="og:site_name" content="Aastha Chopra" />
  <meta property="og:locale" content="en_AE" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Travel Map — Aastha Chopra" />
  <meta name="twitter:description" content="${s.journeys} trips across ${s.countries} countries since ${s.firstYear}, each one with the posts behind it." />
  <meta name="twitter:image" content="${SITE}/images/aastha-chopra-dubai-luxury-travel-hero.jpg" />

  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${SITE}/travel.html`, url: `${SITE}/travel.html`,
        name: 'Travel Map — Aastha Chopra',
        description: `Every trip Aastha Chopra has taken since ${s.firstYear}, across ${s.countries} countries, each with the posts behind it.`,
        about: { '@id': `${SITE}/#aastha` }, isPartOf: { '@id': `${SITE}/#website` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Travel Map', item: `${SITE}/travel.html` },
      ] },
      { '@type': 'ItemList', name: 'Countries visited', numberOfItems: state.dots.length,
        itemListElement: state.dots.map((d, i) => ({ '@type': 'ListItem', position: i + 1, name: d.country })) },
    ],
  })}</script>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="css/world.css" />
  <style>${CSS}</style>
</head>
<body>
${NAV}

  <main class="tm-wrap">
    <section class="tm-intro">
      <p class="tm-eyebrow">Where she has actually been</p>
      <h1>Always just back, or <em>just about to go</em>.</h1>
      <p class="tm-lede">${s.countries} countries since ${s.firstYear}, fitted around a working life and kids at home. Every trip below is one she really took and really posted. Tap a country, a year, or any photograph.</p>
      <div class="tm-stats">
        <div class="tm-stat"><b>${s.countries}</b><span>Countries</span></div>
        <div class="tm-stat"><b>${s.journeys}</b><span>Trips</span></div>
        <div class="tm-stat"><b>${s.posts}</b><span>Posts from the road</span></div>
        <div class="tm-stat"><b>${s.lastYear - s.firstYear + 1}</b><span>Years running</span></div>
      </div>
    </section>

    <div class="tm-mapbox">
      <div id="tm-mapholder"></div>
      <div class="tm-legend">
        <span>Dubai is home</span>
        <span>Every line is a trip out and back</span>
        <span>Bigger dot, more visits</span>
      </div>
    </div>

    <section class="tm-section">
      <h2>It does not let up</h2>
      <p class="tm-note">Each square is one trip. Some years are quieter, some are relentless. None of them are empty.</p>
      <div id="tm-years"></div>
    </section>

    <section class="tm-section" id="tm-trips">
      <h2>The trips</h2>
      <div class="tm-filters" id="tm-filters">
        <span class="tm-showing" id="tm-showing"></span>
        ${state.yearList.slice().reverse().map(y => `<button class="tm-pill" data-year="${y}">${y}</button>`).join('\n        ')}
        <button class="tm-pill" id="tm-clear" hidden>Show all</button>
      </div>
      <div class="tm-grid" id="tm-grid"></div>
    </section>

    <p class="tm-foot">
      Built from her own Instagram archive. Only trips she has confirmed appear here, and local trips around the UAE are not on the map.
      For hotel and tourism partnerships, write to <a href="mailto:management@aasthachopra.com" style="color:var(--gold-light)">management@aasthachopra.com</a>.
    </p>
  </main>

  <footer class="world-footer">
    <p>&copy; Aastha Chopra 2026</p>
    <div class="footer-links">
      <a href="index.html">Home</a>
      <a href="/blog">Journal</a>
      <a href="fashion.html">Fashion</a>
      <a href="luxury.html">Luxury</a>
      <a href="wellness.html">Wellness</a>
      <a href="media-pack.html">Media Kit</a>
      <a href="privacy.html">Privacy</a>
      <a href="https://www.instagram.com/aastha_sochic/" target="_blank" rel="noopener">Instagram</a>
    </div>
  </footer>

  <script id="tm-state" type="application/json">${JSON.stringify(state).replace(/<\//g, '<\\/')}</script>
  <script>${JS}</script>
</body>
</html>`;

writeFileSync(resolve(__dirname, '../travel.html'), html);
console.log(`${state.trips.length} trips, ${state.dots.length} countries.`);
console.log(`${(html.length / 1024).toFixed(0)} KB → travel.html`);
