/**
 * Ratify page → build/ratify-trips.html
 * -----------------------------------------------------------------------------
 * Turns the candidate trips into a page Amit and Aastha can tick through on a
 * phone. Each card shows the photos, the dates, the caption and the reasons the
 * scanner thinks she was or was not there. Three buttons: yes she went, no she
 * did not, not sure.
 *
 * The page keeps its answers by saving a new copy of itself, so whatever is
 * ticked is still there next time either of them opens the link. It also keeps
 * a copy in the phone's own storage, so nothing is lost if saving is off.
 *
 * Run scan-travel.mjs and pack-travel-thumbs.mjs first.
 *
 * Usage:
 *   node scripts/build-ratify-page.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(readFileSync(resolve(__dirname, '..', f), 'utf8'));

const candidates = read('data/travel-candidates.json');
let thumbs = {};
try { thumbs = read('data/travel-thumbs.json'); } catch { console.log('No thumbnails yet, building without photos.'); }

// Carry over any answers already given, so rebuilding never wipes their work.
let previous = {};
try { previous = read('data/travel-verdicts.json'); } catch { /* first run */ }

const trips = candidates.trips.map(t => ({
  id: t.tripId,
  country: t.country,
  lat: t.lat,
  lon: t.lon,
  from: t.firstDate,
  to: t.lastDate,
  span: t.spanDays,
  confidence: t.confidence,
  forIt: t.forIt,
  against: t.against,
  verdict: previous[t.tripId] || null,
  posts: t.posts.map(p => ({
    id: p.postId,
    date: p.date,
    link: p.permalink,
    term: p.matchedOn,
    caption: p.caption,
    views: p.views,
    likes: p.likes,
    img: thumbs[p.postId] || null,
  })),
}));

const state = {
  generatedAt: candidates.generated_at,
  postsScanned: candidates.posts_scanned,
  since: candidates.since,
  trips,
};

const CSS = `
:root{
  --ground:#EDEEEA; --card:#FFFFFF; --card-2:#F6F7F4;
  --ink:#1B1E1C; --ink-soft:#5C625D; --ink-faint:#868C87;
  --rule:#D6D9D1; --stamp:#2E4F6B; --stamp-soft:#E2EAF1;
  --yes:#2C6E49; --no:#9B3B33; --maybe:#8A6620;
  --yes-bg:#E4EFE7; --no-bg:#F6E4E2; --maybe-bg:#F5EDDC;
  --shadow:0 1px 2px rgba(27,30,28,.06), 0 8px 24px -12px rgba(27,30,28,.18);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#14171A; --card:#1C2024; --card-2:#22272B;
    --ink:#E9EBE7; --ink-soft:#9AA19C; --ink-faint:#727974;
    --rule:#2E343A; --stamp:#89B0CF; --stamp-soft:#1E2A34;
    --yes:#63C393; --no:#E28880; --maybe:#D9B268;
    --yes-bg:#17281F; --no-bg:#2C1D1B; --maybe-bg:#2A2318;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6);
  }
}
:root[data-theme="dark"]{
  --ground:#14171A; --card:#1C2024; --card-2:#22272B;
  --ink:#E9EBE7; --ink-soft:#9AA19C; --ink-faint:#727974;
  --rule:#2E343A; --stamp:#89B0CF; --stamp-soft:#1E2A34;
  --yes:#63C393; --no:#E28880; --maybe:#D9B268;
  --yes-bg:#17281F; --no-bg:#2C1D1B; --maybe-bg:#2A2318;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6);
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"Public Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:760px; margin:0 auto; padding:0 16px 96px}

/* ---- header ---- */
header{
  position:sticky; top:0; z-index:20; background:var(--ground);
  border-bottom:1px solid var(--rule); margin-bottom:20px;
}
.head-in{max-width:760px; margin:0 auto; padding:14px 16px 12px; display:flex; flex-direction:column; gap:12px}
.title-row{display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap}
h1{
  font-family:"Instrument Serif", Georgia, serif; font-weight:400;
  font-size:29px; line-height:1.1; margin:0; letter-spacing:-.01em;
}
h1 span{color:var(--ink-faint)}
.sub{color:var(--ink-soft); font-size:13px; margin:2px 0 0}

.meter{display:flex; height:6px; border-radius:99px; overflow:hidden; background:var(--rule)}
.meter i{display:block; height:100%}
.meter i.y{background:var(--yes)} .meter i.n{background:var(--no)} .meter i.m{background:var(--maybe)}

.counts{
  display:flex; gap:14px; flex-wrap:wrap; align-items:center;
  font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12px;
  color:var(--ink-soft); font-variant-numeric:tabular-nums;
}
.counts b{color:var(--ink); font-weight:600}
.dot{width:7px; height:7px; border-radius:99px; display:inline-block; margin-right:5px; vertical-align:1px}

.bar{display:flex; gap:8px; flex-wrap:wrap; align-items:center}
.tab{
  font:inherit; font-size:12.5px; padding:5px 11px; border-radius:99px; cursor:pointer;
  background:transparent; color:var(--ink-soft); border:1px solid var(--rule);
}
.tab[aria-pressed="true"]{background:var(--ink); color:var(--ground); border-color:var(--ink)}
.tab:focus-visible, button:focus-visible, a:focus-visible{outline:2px solid var(--stamp); outline-offset:2px}
.save{
  margin-left:auto; font:inherit; font-size:13px; font-weight:600; padding:7px 15px;
  border-radius:8px; border:1px solid var(--stamp); background:var(--stamp); color:#fff; cursor:pointer;
}
.save[disabled]{opacity:.4; cursor:default}
.save.ghost{background:transparent; color:var(--stamp)}

/* ---- cards ---- */
.list{display:flex; flex-direction:column; gap:14px}
.card{
  background:var(--card); border:1px solid var(--rule); border-radius:12px;
  box-shadow:var(--shadow); overflow:hidden; position:relative;
}
.card::before{content:""; position:absolute; inset:0 auto 0 0; width:3px; background:transparent}
.card[data-v="yes"]::before{background:var(--yes)}
.card[data-v="no"]::before{background:var(--no)}
.card[data-v="maybe"]::before{background:var(--maybe)}
.card[data-v="no"]{opacity:.62}

.card-head{display:flex; gap:13px; padding:14px 15px 12px; align-items:flex-start}
.cover{
  width:64px; height:64px; flex:0 0 64px; border-radius:8px; object-fit:cover;
  background:var(--card-2); border:1px solid var(--rule);
}
.cover.blank{display:grid; place-items:center; font-family:"Instrument Serif",Georgia,serif; font-size:24px; color:var(--ink-faint)}
.who{flex:1; min-width:0}
.country{font-family:"Instrument Serif", Georgia, serif; font-size:21px; line-height:1.15; margin:0}
.when{
  font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:11.5px;
  color:var(--ink-soft); margin:3px 0 0; font-variant-numeric:tabular-nums;
}
.chip{
  display:inline-block; font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:10px; letter-spacing:.07em; text-transform:uppercase;
  padding:2px 7px; border-radius:4px; background:var(--stamp-soft); color:var(--stamp);
  margin-top:7px; border:1px solid transparent;
}
.chip.low{background:transparent; color:var(--ink-faint); border-color:var(--rule)}

.why{padding:0 15px 12px; display:flex; flex-direction:column; gap:4px; font-size:13px}
.why p{margin:0; color:var(--ink-soft)}
.why b{font-weight:600; font-size:11px; letter-spacing:.05em; text-transform:uppercase; margin-right:6px}
.why .f b{color:var(--yes)} .why .a b{color:var(--no)}

details{border-top:1px solid var(--rule); background:var(--card-2)}
summary{
  cursor:pointer; padding:9px 15px; font-size:12.5px; color:var(--ink-soft);
  list-style:none; display:flex; justify-content:space-between; align-items:center;
}
summary::-webkit-details-marker{display:none}
summary::after{content:"›"; transform:rotate(90deg); font-size:16px; color:var(--ink-faint)}
details[open] summary::after{transform:rotate(-90deg)}
.post{display:flex; gap:11px; padding:11px 15px; border-top:1px solid var(--rule); align-items:flex-start}
.post img{width:44px; height:44px; flex:0 0 44px; border-radius:6px; object-fit:cover; border:1px solid var(--rule)}
.post-b{min-width:0; flex:1}
.post-meta{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; color:var(--ink-faint);
  display:flex; gap:9px; flex-wrap:wrap; margin-bottom:3px; font-variant-numeric:tabular-nums;
}
.post-meta a{color:var(--stamp)}
.cap{font-size:12.5px; color:var(--ink-soft); margin:0; overflow-wrap:anywhere}
mark{background:var(--stamp-soft); color:var(--stamp); padding:0 2px; border-radius:2px}

.verdict{display:flex; gap:8px; padding:12px 15px; border-top:1px solid var(--rule)}
.verdict button{
  flex:1; font:inherit; font-size:13.5px; font-weight:600; padding:9px 4px; cursor:pointer;
  border-radius:8px; border:1px solid var(--rule); background:transparent; color:var(--ink-soft);
}
.verdict button:hover{border-color:var(--ink-faint)}
.card[data-v="yes"] .v-yes{background:var(--yes-bg); color:var(--yes); border-color:var(--yes)}
.card[data-v="no"] .v-no{background:var(--no-bg); color:var(--no); border-color:var(--no)}
.card[data-v="maybe"] .v-maybe{background:var(--maybe-bg); color:var(--maybe); border-color:var(--maybe)}

/* ---- footer summary ---- */
.done{
  margin-top:26px; padding:18px 16px; border:1px solid var(--rule);
  border-radius:12px; background:var(--card);
}
.done h2{font-family:"Instrument Serif",Georgia,serif; font-weight:400; font-size:22px; margin:0 0 4px}
.done p{margin:0 0 12px; color:var(--ink-soft); font-size:13px}
.done ul{margin:0; padding-left:18px; columns:2; column-gap:24px; font-size:13.5px}
@media (max-width:520px){ .done ul{columns:1} }
.done li{margin-bottom:3px; break-inside:avoid}
.done li span{font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; color:var(--ink-faint)}

.note{
  font-size:12.5px; color:var(--ink-soft); background:var(--card-2);
  border:1px solid var(--rule); border-radius:8px; padding:10px 13px; margin-bottom:16px;
}
.toast{
  position:fixed; left:50%; bottom:20px; transform:translateX(-50%);
  background:var(--ink); color:var(--ground); padding:9px 16px; border-radius:99px;
  font-size:13px; box-shadow:var(--shadow); z-index:50; opacity:0; pointer-events:none;
  transition:opacity .2s;
}
.toast.on{opacity:1}
@media (prefers-reduced-motion:reduce){ *{transition:none !important; animation:none !important} }
.empty{padding:40px 0; text-align:center; color:var(--ink-faint); font-size:14px}
`;

const JS = String.raw`
const state = JSON.parse(document.getElementById("state").textContent);
const app = document.getElementById("app");
let filter = "todo";
let dirty = false;

const KEY = "aastha-trip-verdicts";
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  for (const t of state.trips) if (saved[t.id] && !t.verdict) t.verdict = saved[t.id];
} catch {}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function highlight(caption, term){
  const safe = esc(caption);
  if (!term) return safe;
  const re = new RegExp("(" + term.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&") + ")", "ig");
  return safe.replace(re, "<mark>$1</mark>");
}

const pretty = iso => {
  const [y,m,d] = iso.split("-");
  return d + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m-1] + " " + y;
};
const dates = t => t.from === t.to ? pretty(t.from) : pretty(t.from) + " to " + pretty(t.to);

const tally = () => {
  const c = {yes:0, no:0, maybe:0, todo:0};
  for (const t of state.trips) c[t.verdict || "todo"]++;
  return c;
};

function matches(t){
  if (filter === "all") return true;
  if (filter === "todo") return !t.verdict;
  return t.verdict === filter;
}

function cardHTML(t){
  const cover = t.posts.find(p => p.img);
  const coverHTML = cover
    ? '<img class="cover" src="' + cover.img + '" alt="">'
    : '<div class="cover blank">' + esc(t.country[0]) + '</div>';
  const posts = t.posts.map(p =>
    '<div class="post">' +
      (p.img ? '<img src="' + p.img + '" alt="">' : '') +
      '<div class="post-b">' +
        '<div class="post-meta">' +
          '<span>' + pretty(p.date) + '</span>' +
          (p.views ? '<span>' + p.views.toLocaleString() + ' views</span>' : '<span>' + p.likes.toLocaleString() + ' likes</span>') +
          '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">open post</a>' +
        '</div>' +
        '<p class="cap">' + highlight(p.caption, p.term) + '</p>' +
      '</div>' +
    '</div>'
  ).join("");

  return '<article class="card" data-id="' + esc(t.id) + '"' + (t.verdict ? ' data-v="' + t.verdict + '"' : '') + '>' +
    '<div class="card-head">' + coverHTML +
      '<div class="who">' +
        '<h3 class="country">' + esc(t.country) + '</h3>' +
        '<p class="when">' + dates(t) + ' &middot; ' + t.posts.length + (t.posts.length === 1 ? ' post' : ' posts') + '</p>' +
        '<span class="chip ' + (t.confidence === "low" ? "low" : "") + '">' +
          (t.confidence === "high" ? "looks solid" : t.confidence === "medium" ? "worth a look" : "probably not a trip") +
        '</span>' +
      '</div>' +
    '</div>' +
    '<div class="why">' +
      t.forIt.map(r => '<p class="f"><b>for</b>' + esc(r) + '</p>').join("") +
      t.against.map(r => '<p class="a"><b>against</b>' + esc(r) + '</p>').join("") +
    '</div>' +
    '<details><summary>See the ' + t.posts.length + ' ' + (t.posts.length === 1 ? "post" : "posts") + '</summary>' + posts + '</details>' +
    '<div class="verdict">' +
      '<button class="v-yes" data-v="yes">She went</button>' +
      '<button class="v-maybe" data-v="maybe">Not sure</button>' +
      '<button class="v-no" data-v="no">Not a trip</button>' +
    '</div>' +
  '</article>';
}

function render(){
  const c = tally();
  const total = state.trips.length;
  const pct = n => (n / total * 100).toFixed(2) + "%";
  const confirmed = state.trips.filter(t => t.verdict === "yes")
    .sort((a,b) => b.from.localeCompare(a.from));
  const countries = [...new Set(confirmed.map(t => t.country))];
  const shown = state.trips.filter(matches);

  document.getElementById("meter").innerHTML =
    '<i class="y" style="width:' + pct(c.yes) + '"></i>' +
    '<i class="m" style="width:' + pct(c.maybe) + '"></i>' +
    '<i class="n" style="width:' + pct(c.no) + '"></i>';

  document.getElementById("counts").innerHTML =
    '<span><span class="dot" style="background:var(--yes)"></span><b>' + c.yes + '</b> real</span>' +
    '<span><span class="dot" style="background:var(--maybe)"></span><b>' + c.maybe + '</b> not sure</span>' +
    '<span><span class="dot" style="background:var(--no)"></span><b>' + c.no + '</b> not a trip</span>' +
    '<span><span class="dot" style="background:var(--rule)"></span><b>' + c.todo + '</b> to go</span>';

  for (const b of document.querySelectorAll(".tab")) {
    b.setAttribute("aria-pressed", String(b.dataset.f === filter));
  }

  app.innerHTML = shown.length
    ? '<div class="list">' + shown.map(cardHTML).join("") + '</div>'
    : '<p class="empty">Nothing here. Try another view.</p>';

  document.getElementById("done").innerHTML = confirmed.length
    ? '<h2>' + confirmed.length + ' confirmed ' + (confirmed.length === 1 ? "trip" : "trips") + ', ' + countries.length + ' ' + (countries.length === 1 ? "country" : "countries") + '</h2>' +
      '<p>This is what goes on the map. Nothing else does.</p>' +
      '<ul>' + confirmed.map(t => '<li>' + esc(t.country) + ' <span>' + t.from.slice(0,7) + '</span></li>').join("") + '</ul>'
    : '<h2>Nothing confirmed yet</h2><p>Tick a trip above and it appears here. Only confirmed trips go on the map.</p>';

  const save = document.getElementById("save");
  save.disabled = !dirty;
  save.textContent = dirty ? "Save answers" : "All saved";
}

app.addEventListener("click", e => {
  const btn = e.target.closest(".verdict button");
  if (!btn) return;
  const card = btn.closest(".card");
  const trip = state.trips.find(t => t.id === card.dataset.id);
  trip.verdict = trip.verdict === btn.dataset.v ? null : btn.dataset.v;
  dirty = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (trip.verdict) saved[trip.id] = trip.verdict; else delete saved[trip.id];
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {}
  render();
});

for (const b of document.querySelectorAll(".tab")) {
  b.addEventListener("click", () => { filter = b.dataset.f; render(); });
}

function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("on");
  setTimeout(() => el.classList.remove("on"), 2600);
}

function wholePage(){
  const css = document.getElementById("css").textContent;
  const js = document.getElementById("code").textContent;
  return "<!doctype html>\n<html lang=\"en\">\n<head>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>Aastha's Travel Ledger</title>\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
    "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap\">\n" +
    "<style id=\"css\">" + css + "</style>\n</head>\n<body>\n" +
    SHELL +
    "<script id=\"state\" type=\"application/json\">" + JSON.stringify(state).replace(/<\//g, "<\\/") + "<\/script>\n" +
    "<script id=\"code\">" + js + "<\/script>\n</body>\n</html>";
}

document.getElementById("save").addEventListener("click", async () => {
  const save = document.getElementById("save");
  save.disabled = true; save.textContent = "Saving...";
  const api = await claude.use("artifact");
  if (!api) {
    save.textContent = "Save answers"; save.disabled = false;
    toast("Saving is off here. Your answers are kept on this phone.");
    return;
  }
  try {
    await api.publish(wholePage());
    dirty = false;
  } catch (err) {
    save.disabled = false; save.textContent = "Save answers";
    if (err && err.code === "conflict") return;
    toast(err && (err.code === "not_writer" || err.code === "not_granted")
      ? "You can look but not save. Answers are kept on this phone."
      : "Could not save. Your answers are still here on this phone.");
  }
});

render();
`;

const SHELL = `<header>
  <div class="head-in">
    <div class="title-row">
      <div>
        <h1>Where has she <span>actually</span> been?</h1>
        <p class="sub">${state.trips.length} possible trips found by reading ${state.postsScanned.toLocaleString()} captions. Every one is a guess until you say otherwise.</p>
      </div>
    </div>
    <div class="meter" id="meter"></div>
    <div class="counts" id="counts"></div>
    <div class="bar">
      <button class="tab" data-f="todo">To check</button>
      <button class="tab" data-f="yes">Real</button>
      <button class="tab" data-f="maybe">Not sure</button>
      <button class="tab" data-f="no">Not trips</button>
      <button class="tab" data-f="all">Everything</button>
      <button class="save" id="save">All saved</button>
    </div>
  </div>
</header>
<div class="wrap">
  <p class="note">A word search cannot tell a holiday from a handbag. "Goldfield &amp; Banks Australia" is a perfume, "Teatro Firenze" is a fragrance house, and Spa Ceylon opened in Dubai. Tap through and only the real ones survive.</p>
  <div id="app"></div>
  <section class="done" id="done"></section>
</div>
<div class="toast" id="toast"></div>
`;

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">';

const scripts = `<script id="state" type="application/json">${JSON.stringify(state).replace(/<\//g, '<\\/')}</script>
<script id="code">const SHELL = ${JSON.stringify(SHELL)};
${JS}</script>`;

// The published version: page content only. The viewer supplies the document
// around it, and the title tag near the top is what names the page.
const body = `<title>Aastha's Travel Ledger</title>
${FONTS}
<style id="css">${CSS}</style>
${SHELL}
${scripts}`;

// The local copy: a whole page, so it can be opened straight off the disk.
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aastha's Travel Ledger</title>
${FONTS}
<style id="css">${CSS}</style>
</head>
<body>
${SHELL}
${scripts}
</body>
</html>`;

mkdirSync(resolve(__dirname, '../build'), { recursive: true });
writeFileSync(resolve(__dirname, '../build/ratify-artifact.html'), body);
writeFileSync(resolve(__dirname, '../build/ratify-trips.html'), standalone);
console.log(`${trips.length} trips, ${Object.keys(thumbs).length} photos baked in.`);
console.log(`${(body.length / 1048576).toFixed(2)} MB → build/ratify-artifact.html (the one to publish)`);
console.log(`${(standalone.length / 1048576).toFixed(2)} MB → build/ratify-trips.html (opens off the disk)`);
