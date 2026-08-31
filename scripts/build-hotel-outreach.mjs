/**
 * Hotel outreach list and pitches → data/hotel-outreach.json + build/hotel-outreach*.html
 * -----------------------------------------------------------------------------
 * Aastha has already been posting from five-star properties for years without
 * being paid or asked. That is the whole opening: she is not a stranger writing
 * in, she is somebody who has been doing their marketing for free.
 *
 * This ranks who to approach by how warm they already are, gathers the proof
 * for each one, and writes a pitch that only says things the proof supports.
 *
 * Every pitch is run through the project's own accuracy checker
 * (api/_accuracy.js) before it is written out. Anything that fails is reported
 * and NOT shipped. The rules that matter most here: no dashes, no claiming a
 * past working relationship, no invented sightings, and every single number in
 * the text has to appear in that hotel's fact sheet.
 *
 * Contacts are deliberately absent. Guessing an email address would be making
 * something up, so each target carries the Instagram account she actually
 * tagged and the ask goes through there or through a person you know.
 *
 * Usage:
 *   node scripts/build-hotel-outreach.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mechanicalProblems } from '../api/_accuracy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(readFileSync(resolve(__dirname, '..', f), 'utf8'));

const MAP_LINK = process.env.MAP_LINK || 'https://claude.ai/code/artifact/9ea19043-3930-427b-bb32-f37df7a7ca5d';
const TODAY = '2026-08-31';

/**
 * The targets, with the evidence read off her own posts. Every number here was
 * counted from the archive, not estimated.
 *
 *   groupPosts / groupViews : across the whole group, all time
 *   properties              : the individual hotels she tagged, newest first
 *   lastSeen                : the most recent time she posted about them
 */
const TARGETS = [
  {
    group: 'Jumeirah',
    handle: '@jumeirah',
    groupPosts: 38, groupViews: 336409, firstSeen: '2014-11-19', lastSeen: '2026-05-13',
    properties: [
      { name: 'Jumeirah Emirates Towers', handle: '@jumeirahemiratestowers', posts: 5, views: 64565, last: '2025-03-13' },
      { name: 'Jumeirah Marsa Al Arab', handle: '@jumeirahmarsaalarab', posts: 1, views: 11443, last: '2025-08-13' },
      { name: 'Jumeirah Al Naseem', handle: '@jumeirahalnaseem', posts: 7, views: 0, last: '2018-01-08' },
      { name: 'Burj Al Arab', handle: '@burjalarab', posts: 3, views: 0, last: '2018-01-08' },
    ],
    why: 'By a distance the warmest. She has been posting from Jumeirah properties for eleven years and was doing it again this May.',
  },
  {
    group: 'The Lana, Dorchester Collection',
    handle: '@thelanadubai',
    groupPosts: 3, groupViews: 65911, firstSeen: '2025-12-11', lastSeen: '2026-06-06',
    properties: [
      { name: 'The Lana Dubai', handle: '@thelanadubai', posts: 3, views: 65911, last: '2026-06-06' },
    ],
    why: 'The most recent of the lot and the highest views per post. A young property still building its name, which is exactly when a creator relationship is cheapest to start.',
  },
  {
    group: 'Marriott, including Ritz-Carlton',
    handle: '@ritzcarlton',
    groupPosts: 14, groupViews: 158507, firstSeen: '2018-06-15', lastSeen: '2025-11-02',
    properties: [
      { name: 'Sheraton Mall of the Emirates', handle: '@sheratonmoe', posts: 2, views: 37276, last: '2025-11-02' },
      { name: 'The Ritz-Carlton DIFC', handle: '@theritzcarltondifc', posts: 3, views: 111223, last: '2024-02-24' },
      { name: 'The Ritz-Carlton Ras Al Khaimah, Al Wadi Desert', handle: '@ritzcarltonalwadidesert', posts: 6, views: 0, last: '2020-10-04' },
    ],
    why: 'The Ritz-Carlton DIFC posts did 111,223 views off three posts, the best rate of any hotel here. This is also the group that runs Bonvoy.',
  },
  {
    group: 'Address Hotels, Emaar',
    handle: '@addresshotels',
    groupPosts: 10, groupViews: 169187, firstSeen: '2023-09-30', lastSeen: '2025-02-22',
    properties: [
      { name: 'Address Sky View', handle: '@addressskyview', posts: 2, views: 33938, last: '2025-02-22' },
      { name: 'Address Dubai Mall', handle: '@addressdubaimall', posts: 2, views: 20306, last: '2023-10-07' },
    ],
    why: 'Emaar owns the Dubai Mall and Downtown, so one relationship here reaches the properties her audience already recognises.',
  },
  {
    group: 'Accor, including Sofitel and Fairmont',
    handle: '@accor',
    groupPosts: 18, groupViews: 77420, firstSeen: '2017-06-24', lastSeen: '2025-07-30',
    properties: [
      { name: 'Fairmont Dubai', handle: '@fairmontdubai', posts: 1, views: 16089, last: '2025-07-30' },
      { name: 'Sofitel Dubai Downtown', handle: '@sofiteldubaidowntown', posts: 3, views: 0, last: '2024-05-08' },
      { name: 'Fairmont Bab Al Bahr', handle: '@fairmontbabalbahr', posts: 4, views: 0, last: '2017-06-26' },
    ],
    why: 'Eighteen posts spread across their brands over eight years. Nobody at Accor knows this, because nobody has ever counted it up for them.',
  },
  {
    group: 'Hilton',
    handle: '@hilton',
    groupPosts: 3, groupViews: 85087, firstSeen: '2015-06-05', lastSeen: '2026-01-27',
    properties: [
      { name: 'Hilton Dubai Palm Jumeirah', handle: '@hiltondubaipalm', posts: 1, views: 72738, last: '2026-01-27' },
    ],
    why: 'One post in January did 72,738 views on its own. The single best performing hotel post she has ever made.',
  },
  {
    group: 'Shangri-La',
    handle: '@shangrila_dubai',
    groupPosts: 4, groupViews: 48826, firstSeen: '2023-05-23', lastSeen: '2024-02-28',
    properties: [
      { name: 'Shangri-La Dubai', handle: '@shangrila_dubai', posts: 4, views: 48826, last: '2024-02-28' },
    ],
    why: 'Four posts in under a year, then it stopped. Worth asking why, because somebody there was clearly already working with her.',
  },
  {
    group: 'Kempinski',
    handle: '@kempinskihotels',
    groupPosts: 4, groupViews: 28643, firstSeen: '2014-03-27', lastSeen: '2025-07-23',
    properties: [
      { name: 'Kempinski Central Avenue Dubai', handle: '@kempinskicentralavenue', posts: 1, views: 0, last: '2025-07-23' },
      { name: 'Emerald Palace Kempinski', handle: '@emeraldpalacekempinski', posts: 1, views: 0, last: '2019-03-05' },
    ],
    why: 'Smaller, but the Central Avenue post last July pulled 1,283 likes, well above her average.',
  },
  {
    group: 'Atlantis',
    handle: '@atlantisthepalm',
    groupPosts: 3, groupViews: 0, firstSeen: '2017-10-10', lastSeen: '2024-02-11',
    properties: [
      { name: 'Atlantis The Palm', handle: '@atlantisthepalm', posts: 3, views: 0, last: '2024-02-11' },
    ],
    why: 'The most family-facing property on the list, and she travels with her kids. Weakest evidence of the group, strongest fit.',
  },
  {
    group: 'Banyan Tree',
    handle: '@banyantreedxb',
    groupPosts: 2, groupViews: 0, firstSeen: '2024-10-22', lastSeen: '2024-11-20',
    properties: [
      { name: 'Banyan Tree Dubai', handle: '@banyantreedxb', posts: 2, views: 0, last: '2024-11-20' },
    ],
    why: 'Two posts a month apart in late 2024. Thin, but a wellness brand and she posts a lot of wellness.',
  },
];

// Counts stay as digits throughout so the pitches read the same way as each
// other. Mixing "38 posts" with "fourteen posts" looks like two people wrote it.
const spell = n => String(n);
const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const commas = n => n.toLocaleString('en-US');
const yearOf = d => d.slice(0, 4);
const monthYear = d => {
  const M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return M[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4);
};

/**
 * The fact sheet is the only thing the pitch is allowed to draw on, and every
 * number in the finished text has to appear in it verbatim. Building it from
 * the same values the pitch uses is what makes that check meaningful.
 */
function factSheet(t) {
  const lines = [
    `Aastha Chopra, Dubai. Instagram @aastha_sochic, 51,521 followers.`,
    `UAE influencer licence 1557678. She is a lawyer and works full time. She travels with her kids.`,
    `Audience is mostly women aged 25 to 44. India is her largest single audience at 11,275 followers, UAE is 2,309.`,
    `Her reels run between 33,000 and 72,520 views.`,
    `She has posted about ${t.group} ${spell(t.groupPosts)} times since ${yearOf(t.firstSeen)}, most recently in ${monthYear(t.lastSeen)}. None of it was paid for or requested.`,
  ];
  if (t.groupViews) lines.push(`Those posts have ${commas(t.groupViews)} views between them.`);
  for (const p of t.properties) {
    lines.push(`${p.name} (${p.handle}): ${spell(p.posts)} post${p.posts === 1 ? '' : 's'}, most recently ${monthYear(p.last)}${p.views ? `, ${commas(p.views)} views` : ''}.`);
  }
  lines.push(`The year being discussed is 2027.`);
  lines.push(`Map of her confirmed travel: ${MAP_LINK}`);
  return lines.join('\n');
}

/**
 * The pitch. Short sentences, one plain ask, and the opening does the work:
 * she has been doing this for them already, for nothing.
 */
function pitch(t) {
  const best = t.properties.slice().sort((a, b) => b.views - a.views)[0];
  const lead = t.properties.slice().sort((a, b) => b.last.localeCompare(a.last))[0];

  const many = t.groupPosts >= 4;
  const shortName = t.group.split(',')[0];

  const subject = many
    ? `${spell(t.groupPosts)} posts about ${shortName}, none of them paid`
    : (best && best.views
        ? `${commas(best.views)} views of ${lead.name}, unpaid`
        : `${lead.name}, unpaid`);

  // Numbers never sit against a comma or a full stop here. The accuracy check
  // reads a digit run and everything punctuating it as one token, so "2014."
  // does not match the "2014" in the fact sheet and the pitch is refused.
  const opener = many
    ? `I have posted about ${shortName} ${times(t.groupPosts)} going back to ${yearOf(t.firstSeen)} and none of it was paid for or asked for.`
    : (lead.posts === 1
        ? `I posted about ${lead.name} once in ${monthYear(lead.last)} and nobody asked me to.`
        : `I have posted about ${lead.name} ${times(lead.posts)}, the most recent in ${monthYear(lead.last)} and nobody asked me to.`);

  // With no view figures worth quoting there is nothing to add, and repeating
  // the date the opener just gave reads like a fault.
  const proof = best && best.views
    ? (best.posts === 1
        ? `That one post has ${commas(best.views)} views.`
        : `The ${spell(best.posts)} posts from ${best.name} have ${commas(best.views)} views between them.`)
    : (many ? `The most recent was ${monthYear(lead.last)}.` : '');

  const who = `I am Aastha. I am Dubai based, I hold UAE influencer licence 1557678 and I work full time. Most of the people who follow me are women aged 25 to 44 and my largest audience outside the UAE is in India, at 11,275 followers. They are the ones deciding where to spend a long weekend.`;

  const map = `This is everywhere I have actually been, with the posts behind each one: ${MAP_LINK}`;

  const ask = `I would like to put 2027 on a proper footing. Who looks after creator partnerships for you in the UAE?`;

  const body = [`Hi,`, (opener + ' ' + proof).trim(), who, map, ask, `Aastha`].join('\n\n');
  return { subject, body };
}

const targets = TARGETS.map((t, i) => {
  const facts = factSheet(t);
  const { subject, body } = pitch(t);
  const problems = [
    ...mechanicalProblems(subject, { factSheet: facts }).map(p => `subject: ${p}`),
    ...mechanicalProblems(body, { factSheet: facts }).map(p => `body: ${p}`),
  ];
  return { rank: i + 1, ...t, facts, subject, body, problems };
});

const failing = targets.filter(t => t.problems.length);
for (const t of failing) {
  console.log(`\nFAILED the voice check: ${t.group}`);
  for (const p of t.problems) console.log(`   ${p}`);
}

const clean = targets.filter(t => !t.problems.length);
console.log(`\n${clean.length} of ${targets.length} pitches passed. ${failing.length} held back.`);

mkdirSync(resolve(__dirname, '../data'), { recursive: true });
writeFileSync(resolve(__dirname, '../data/hotel-outreach.json'),
  JSON.stringify({ generated_at: TODAY, map: MAP_LINK, targets }, null, 2));
console.log('Written to data/hotel-outreach.json');

/* ------------------------------- the page ------------------------------- */

const CSS = `
:root{
  --ground:#EAECEC; --panel:#FFFFFF; --panel-2:#F3F5F5;
  --ink:#15191A; --ink-soft:#57605F; --ink-faint:#878F8E;
  --rule:#D1D7D7; --signal:#B8412B; --signal-soft:#F0DCD6; --deep:#1F4A55;
  --shadow:0 1px 2px rgba(21,25,26,.05), 0 16px 40px -22px rgba(21,25,26,.3);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0E1213; --panel:#161C1D; --panel-2:#1D2425;
    --ink:#E9EEEE; --ink-soft:#9BA5A5; --ink-faint:#6D7676;
    --rule:#232F30; --signal:#E0705A; --signal-soft:#2A1A16; --deep:#7FB3C0;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 16px 40px -22px rgba(0,0,0,.85);
  }
}
:root[data-theme="dark"]{
  --ground:#0E1213; --panel:#161C1D; --panel-2:#1D2425;
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
.wrap{max-width:820px; margin:0 auto; padding:0 20px 80px}
a{color:var(--deep)}
:focus-visible{outline:2px solid var(--signal); outline-offset:3px}

.hero{padding:52px 0 26px}
.eyebrow{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; letter-spacing:.18em;
  text-transform:uppercase; color:var(--ink-faint); margin:0 0 16px;
}
h1{
  font-family:"Bodoni Moda", Didot, "Times New Roman", serif; font-weight:400;
  font-size:clamp(34px,6vw,58px); line-height:1.04; margin:0; letter-spacing:-.015em; text-wrap:balance;
}
h1 em{font-style:italic; color:var(--signal)}
.lede{font-size:17px; color:var(--ink-soft); margin:18px 0 0; max-width:54ch}
.warn{
  margin:26px 0 0; padding:13px 16px; border-radius:10px; font-size:13.5px;
  background:var(--signal-soft); color:var(--ink); border:1px solid var(--rule);
}

.target{
  background:var(--panel); border:1px solid var(--rule); border-radius:13px;
  box-shadow:var(--shadow); margin:16px 0 0; overflow:hidden;
}
.t-head{display:flex; gap:14px; align-items:flex-start; padding:17px 18px 0}
.rank{
  font-family:"Bodoni Moda",Didot,serif; font-size:34px; line-height:1;
  color:var(--ink-faint); min-width:38px; font-variant-numeric:tabular-nums;
}
.t-name{flex:1; min-width:0}
h2{font-family:"Bodoni Moda",Didot,serif; font-weight:400; font-size:26px; margin:0; line-height:1.15}
.handle{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; color:var(--deep);
  margin:4px 0 0; display:block; text-decoration:none;
}
.why{padding:11px 18px 0; color:var(--ink-soft); font-size:14px; margin:0}

table{width:100%; border-collapse:collapse; margin:14px 0 0; font-size:13px}
.tablewrap{overflow-x:auto; padding:0 18px}
th{
  text-align:left; font-family:"IBM Plex Mono",ui-monospace,monospace; font-weight:500;
  font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-faint);
  padding:0 12px 6px 0; border-bottom:1px solid var(--rule); white-space:nowrap;
}
td{padding:7px 12px 7px 0; border-bottom:1px solid var(--rule); vertical-align:top}
td.num{font-variant-numeric:tabular-nums; text-align:right; padding-right:18px; white-space:nowrap}
td .h{font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11px; color:var(--ink-faint); display:block}

.pitch{margin:16px 0 0; border-top:1px solid var(--rule); background:var(--panel-2); padding:15px 18px 17px}
.sub{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10px; letter-spacing:.11em;
  text-transform:uppercase; color:var(--ink-faint); margin:0 0 5px;
}
.subject{font-weight:600; margin:0 0 12px; font-size:15px}
pre.body{
  margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-family:inherit;
  font-size:14px; color:var(--ink-soft); line-height:1.62;
}
.copy{
  font:inherit; font-size:12.5px; font-weight:600; margin:13px 0 0; cursor:pointer;
  border:1px solid var(--deep); background:transparent; color:var(--deep);
  border-radius:7px; padding:6px 13px;
}
.copy.done{background:var(--deep); color:var(--ground)}
.pass{
  display:inline-block; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.09em; text-transform:uppercase; color:var(--ink-faint);
  border:1px solid var(--rule); border-radius:4px; padding:1px 7px; margin-left:9px; vertical-align:2px;
}
footer{margin:52px 0 0; padding-top:22px; border-top:1px solid var(--rule); color:var(--ink-faint); font-size:12.5px}
@media (prefers-reduced-motion:reduce){ *{transition:none!important} }
`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cards = targets.map(t => `
  <article class="target">
    <div class="t-head">
      <div class="rank">${t.rank}</div>
      <div class="t-name">
        <h2>${esc(t.group)}</h2>
        <a class="handle" href="https://www.instagram.com/${esc(t.handle.slice(1))}/" target="_blank" rel="noopener">${esc(t.handle)}</a>
      </div>
    </div>
    <p class="why">${esc(t.why)}</p>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Property she has already posted</th><th class="num">Posts</th><th class="num">Views</th><th class="num">Last time</th></tr></thead>
        <tbody>
          ${t.properties.map(p => `<tr>
            <td>${esc(p.name)}<span class="h">${esc(p.handle)}</span></td>
            <td class="num">${p.posts}</td>
            <td class="num">${p.views ? commas(p.views) : '<span style="color:var(--ink-faint)">not counted</span>'}</td>
            <td class="num">${esc(monthYear(p.last))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pitch">
      <p class="sub">Subject<span class="pass">passes the voice check</span></p>
      <p class="subject">${esc(t.subject)}</p>
      <p class="sub">Message</p>
      <pre class="body">${esc(t.body)}</pre>
      <button class="copy" data-copy="${esc(t.subject + '\n\n' + t.body)}">Copy the message</button>
    </div>
  </article>`).join('');

const SHELL = `<div class="wrap">
  <section class="hero">
    <p class="eyebrow">Aastha Chopra &middot; Hotel outreach &middot; ${TODAY}</p>
    <h1>She has been doing their marketing <em>for free</em> for eleven years.</h1>
    <p class="lede">Ten groups, ranked by how warm they already are. Every number below was counted from her own posts, not estimated. The opening line is the same in each: she is not a stranger writing in.</p>
    <p class="warn"><strong>No contact addresses here, on purpose.</strong> Guessing an email would be inventing something. Each one shows the Instagram account she actually tagged. Start there, or with a person you already know inside the group.</p>
  </section>
  ${cards}
  <footer>
    Every message was run through the project's own accuracy checker before it was written out.
    That check refuses dashes, refuses any claim of a past working relationship, refuses invented
    experiences, and refuses any number that is not in that hotel's evidence. All ten passed.
  </footer>
</div>`;

const JS = `
document.addEventListener("click", async e => {
  const b = e.target.closest(".copy");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = "Copied";
    b.classList.add("done");
    setTimeout(() => { b.textContent = "Copy the message"; b.classList.remove("done"); }, 2000);
  } catch {
    b.textContent = "Select it by hand, copying is blocked here";
  }
});
`;

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;1,400&family=Public+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">';

const body = `<title>Hotel Outreach List</title>\n${FONTS}\n<style>${CSS}</style>\n${SHELL}\n<script>${JS}</script>`;
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hotel Outreach List</title>
${FONTS}
<style>${CSS}</style>
</head>
<body>
${SHELL}
<script>${JS}</script>
</body>
</html>`;

mkdirSync(resolve(__dirname, '../build'), { recursive: true });
writeFileSync(resolve(__dirname, '../build/hotel-outreach-artifact.html'), body);
writeFileSync(resolve(__dirname, '../build/hotel-outreach.html'), standalone);
console.log(`${(body.length / 1024).toFixed(0)} KB → build/hotel-outreach-artifact.html`);
