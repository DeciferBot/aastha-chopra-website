/**
 * Quality gates for auto-published Journal posts.
 *
 * The August 2026 audit of 64 auto-published posts found the same failures over
 * and over: sentences pasted from hotel and shop websites, first-person claims
 * with nothing behind them, prices and directions that were simply wrong, the
 * same question answered three times, and house-style breaches (em dashes,
 * "Sunday to Thursday", a year in the title).
 *
 * Every one of those is checkable before publishing. This module is the check.
 * Nothing reaches the site without passing all three gates:
 *
 *   1. rules   deterministic, free, instant. Style, structure, links, refs.
 *   2. editor  one Claude call, no tools. Is it pasted? Is the "I" earned?
 *   3. facts   one Claude call with web_search. Are the specifics true?
 *
 * The gates FAIL CLOSED. If a gate cannot run (no time, API error), the post is
 * not published. A post that never publishes costs nothing; a wrong one costs
 * the trust the whole site is built on.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

// ── House rules, kept next to the checks that enforce them ─────────────────

/** Marketing words the audit found in pasted copy. Presence is a strong tell. */
const BANNED_WORDS = [
  'elevate', 'elevated', 'curated', 'unforgettable', 'nestled', 'must-visit',
  'must visit', 'game-changer', 'game changer', 'sanctuary', 'indulge',
  'premier destination', 'in today', 'fast-paced', 'look no further',
  'whether you are looking', 'nothing short of', 'a testament to',
];

/** Proper nouns that legitimately contain a banned word. Checked case-sensitively. */
const BANNED_EXCEPTIONS = ['Curated by Zahraa'];

/** Source domains that are shops or SEO farms writing about their own product. */
const WEAK_SOURCE_HOSTS = [
  'translate.goog', 'blogspot.', 'medium.com', 'quora.com', 'pinterest.',
  'alibaba.com', 'aliexpress.', 'tripadvisor.com/ShowTopic',
];

const PILLAR_WORD_MIN = 1000;
const PILLAR_WORD_MAX = 1800;

export const QA_LIMITS = { wordMin: 700, wordMax: 1800, metaMin: 110, metaMax: 175, faqMin: 3, faqMax: 7 };

/** Strip tags for word counting and prose checks. */
function text(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function wordCount(html) {
  const t = text(html);
  return t ? t.split(' ').length : 0;
}

/**
 * Gate 1 — deterministic rules.
 *
 * ctx: { publishedSlugs:Set, knownPermalinks:Set }
 * Returns { pass, problems[] }. Problems are phrased as instructions so the
 * revision pass can act on them directly.
 */
export function ruleGate(post, ctx = {}) {
  const problems = [];
  const publishedSlugs = ctx.publishedSlugs || new Set();
  const knownPermalinks = ctx.knownPermalinks || new Set();

  const title = String(post.title || '');
  const meta = String(post.meta_description || '');
  const excerpt = String(post.excerpt || '');
  const body = String(post.body_html || '');
  const faq = Array.isArray(post.faq) ? post.faq : [];
  const refs = Array.isArray(post.instagram_refs) ? post.instagram_refs : [];
  const sources = Array.isArray(post.research_sources) ? post.research_sources : [];
  const all = [title, meta, excerpt, text(body), ...faq.map((f) => `${f && f.q} ${f && f.a}`)].join(' ');

  // Required fields.
  if (!title) problems.push('The title is missing.');
  if (!body) problems.push('The body_html is missing.');
  if (!excerpt) problems.push('The excerpt is missing: it must be the direct answer in one or two sentences.');

  // Style.
  if (/[—–]/.test(all)) problems.push('Remove every em dash and en dash. Use commas, full stops, or "to" for ranges.');
  if (/\b20\d\d\b/.test(title)) problems.push('Remove the year from the title. Years go stale.');
  if (/\b(ultimate|complete guide|definitive)\b/i.test(title)) problems.push('Remove "ultimate", "complete guide" or "definitive" from the title.');
  if (/sunday to thursday/i.test(all)) problems.push('The UAE working week is Monday to Friday, not Sunday to Thursday. Fix it.');
  if (/\b\d+\s*(aed|dirhams)\b/i.test(all)) problems.push('Write money as "AED 280", never "280 AED" or "280 dirhams".');

  const lower = (() => {
    let s = all;
    for (const keep of BANNED_EXCEPTIONS) s = s.split(keep).join(' ');
    return s.toLowerCase();
  })();
  for (const w of BANNED_WORDS) {
    if (lower.includes(w)) problems.push(`Remove the marketing word "${w}" and say the plain thing instead.`);
  }

  // Length.
  const wc = wordCount(body);
  if (wc < QA_LIMITS.wordMin) problems.push(`The article is ${wc} words. Answer more of the real sub-questions until it is at least ${QA_LIMITS.wordMin}, without padding.`);
  if (wc > QA_LIMITS.wordMax) problems.push(`The article is ${wc} words. Cut it to under ${QA_LIMITS.wordMax} by removing anything that does not teach something.`);
  if (meta.length < QA_LIMITS.metaMin || meta.length > QA_LIMITS.metaMax) {
    problems.push(`The meta_description is ${meta.length} characters. Rewrite it to between ${QA_LIMITS.metaMin} and ${QA_LIMITS.metaMax}, answer first.`);
  }
  if (faq.length < QA_LIMITS.faqMin || faq.length > QA_LIMITS.faqMax) {
    problems.push(`There are ${faq.length} FAQ entries. Give between ${QA_LIMITS.faqMin} and ${QA_LIMITS.faqMax} real questions people type.`);
  }

  // Structure.
  if (/<h1/i.test(body)) problems.push('Remove the <h1>. The page supplies its own heading.');
  if (/<script/i.test(body)) problems.push('Remove the <script> tag.');
  if (/\sstyle=/i.test(body)) problems.push('Remove inline style attributes.');
  if (/<img/i.test(body)) problems.push('Remove the <img> tag. Images come from the linked Instagram post.');
  if (/```/.test(body) || /^\s*#{1,3}\s/m.test(body)) problems.push('The body must be HTML, not markdown.');
  if (!/<h2[\s>]/i.test(body)) problems.push('Add H2 headings, each one a real question people search.');

  // Unbalanced tags break the page layout.
  for (const tag of ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'table', 'tr', 'td', 'th']) {
    const open = (body.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    const close = (body.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (open !== close) problems.push(`The <${tag}> tags are unbalanced (${open} open, ${close} closed). Fix the HTML.`);
  }

  // Internal links must point at posts that actually exist and are live.
  const linked = [...body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const s of new Set(linked)) {
    if (!publishedSlugs.has(s)) problems.push(`The internal link /blog/${s} does not point at a published post. Link only to posts in the existing list.`);
  }
  if (!linked.length) problems.push('Add one or two links to related guides from the existing list, as <a href="/blog/slug">anchor</a>.');

  // Instagram references must be real posts of hers.
  for (const r of refs) {
    const pl = String((r && r.permalink) || '');
    const id = (pl.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1];
    if (!id) problems.push(`The Instagram link "${pl}" is not a valid post or reel URL.`);
    else if (knownPermalinks.size && !knownPermalinks.has(id)) {
      problems.push(`The Instagram link ${pl} is not one of Aastha's posts. Only reference posts from the list you were given.`);
    }
  }

  // Sources.
  if (sources.length < 2) problems.push('Cite at least two real sources you actually used.');
  for (const s of sources) {
    const url = String((s && s.url) || '');
    if (!/^https?:\/\//.test(url)) problems.push(`The source URL "${url}" is not a valid link.`);
    else if (WEAK_SOURCE_HOSTS.some((h) => url.includes(h))) problems.push(`Replace the weak source ${url} with an official or major-press source.`);
  }

  // Disclosure: if the piece talks about gifted or partner product, say so.
  const partnerish = /\b(gifted|invited me|press day|use my code|partnership|hosted (me|us)|sent me)\b/i.test(text(body));
  if (partnerish && !/class="bdisclosure"/.test(body)) {
    problems.push('The article mentions gifted or partner product. Add one <p class="bdisclosure">Disclosure: ...</p> line inside the body.');
  }

  return { pass: problems.length === 0, problems, wordCount: wc };
}

// ── Gate 2: the editor ─────────────────────────────────────────────────────

const EDITOR_SYSTEM = `You are a hard-nosed editor checking a draft before it auto-publishes on a real person's website. Nobody reads it after you. Your job is to REJECT anything that would embarrass her.

You are given the draft, the exact Instagram captions it is allowed to draw first-person experience from, and the titles already on the site.

Judge only these five things, and be strict. A 5 means genuinely good, a 3 means "a reader would notice something off", a 1 means bad.

1. own_words: is every sentence written in a normal human voice, or are there sentences lifted from a hotel, shop or brand website? Marketing cadence, feature lists, and phrases praising the venue in its own words are the tell.
2. experience_supported: every first-person claim of having been somewhere, worn something or used a product must be supported by one of the captions provided. Inventing an experience is the worst failure here. If the article makes no first-person claims, score 5.
3. answers_question: does the piece answer its own title in the first few sentences and then genuinely go deeper, or does it circle?
4. internally_consistent: does it contradict itself on prices, timings or advice?
5. distinct: is it a different question from the existing titles, not a reheat?

Return ONLY this JSON, no prose, no code fences:
{"own_words":0-5,"experience_supported":0-5,"answers_question":0-5,"internally_consistent":0-5,"distinct":0-5,
 "problems":["specific, actionable instruction","..."],
 "unsupported_claims":["the exact sentence that claims an experience with no caption behind it"],
 "pasted_sentences":["the exact sentence that reads as lifted"]}`;

/**
 * Gate 2 — one Claude call, no tools. `callClaude({system,user,useTools})` is
 * injected so this module does not duplicate the API wiring.
 */
export async function editorGate({ post, igPosts = [], existing = [], callClaude, parseJson }) {
  const captions = igPosts.length
    ? igPosts.map((p) => `- ${p.permalink}\n  ${String(p.caption || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    : '(none supplied)';
  const titles = existing.slice(0, 60).map((e) => `- ${e.title}`).join('\n');

  const user = `TITLE: ${post.title}

EXCERPT: ${post.excerpt || ''}

BODY:
${post.body_html || ''}

FAQ:
${(post.faq || []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')}

THE ONLY INSTAGRAM POSTS THIS ARTICLE MAY DRAW FIRST-PERSON EXPERIENCE FROM:
${captions}

TITLES ALREADY ON THE SITE:
${titles}`;

  const data = await callClaude({ system: EDITOR_SYSTEM, user, useTools: false, maxTokens: 2000 });
  const verdict = parseJson(extractText(data));
  if (!verdict) return { pass: false, problems: ['The editor check did not return a usable verdict.'], scores: null };

  const scores = {
    own_words: num(verdict.own_words),
    experience_supported: num(verdict.experience_supported),
    answers_question: num(verdict.answers_question),
    internally_consistent: num(verdict.internally_consistent),
    distinct: num(verdict.distinct),
  };

  const problems = [];
  // Inventing an experience or pasting copy are disqualifying, not deductions.
  if (scores.experience_supported < 4) {
    problems.push('Every first-person claim must match one of the supplied Instagram captions. Remove or rewrite the ones that do not.');
    for (const s of arr(verdict.unsupported_claims).slice(0, 5)) problems.push(`Unsupported first-person claim: "${String(s).slice(0, 200)}"`);
  }
  if (scores.own_words < 4) {
    problems.push('Rewrite in your own plain words. Some sentences read as lifted from a brand or venue website.');
    for (const s of arr(verdict.pasted_sentences).slice(0, 5)) problems.push(`Reads as pasted: "${String(s).slice(0, 200)}"`);
  }
  if (scores.answers_question < 4) problems.push('Answer the title question directly in the first three sentences, then go deeper.');
  if (scores.internally_consistent < 4) problems.push('The article contradicts itself. Make prices, timings and advice agree.');
  if (scores.distinct < 4) problems.push('This is too close to a question the site already answers. It should not be published.');
  for (const p of arr(verdict.problems).slice(0, 8)) problems.push(String(p).slice(0, 300));

  return { pass: problems.length === 0, problems, scores };
}

// ── Gate 3: the facts ──────────────────────────────────────────────────────

const FACT_SYSTEM = `You are fact-checking a draft article about Dubai and the UAE before it publishes automatically. Nobody checks it after you.

Pull out every specific, checkable claim: prices and price ranges, addresses and locations, opening hours, metro or transport directions, "X is at Y", founding dates, statistics, and rules or regulations. Ignore opinions, styling advice and anything about how something feels.

Use web_search to check the ones that matter most. Search at most six times. Prefer official sites, the venue's own site, and major UAE press.

Mark each claim:
- "ok": you found support, or it is a safely hedged range.
- "unverified": you could not confirm it. Not necessarily wrong.
- "wrong": you found good evidence it is incorrect.

Return ONLY this JSON, no prose, no code fences:
{"claims":[{"claim":"the exact claim","verdict":"ok|unverified|wrong","note":"what you found, one line"}],
 "wrong_count":0,"unverified_count":0}`;

/** Gate 3 — one Claude call with web_search. */
export async function factGate({ post, callClaude, parseJson }) {
  const user = `TITLE: ${post.title}

ARTICLE:
${post.body_html || ''}

FAQ:
${(post.faq || []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')}`;

  const data = await callClaude({ system: FACT_SYSTEM, user, useTools: true, maxTokens: 4000, maxSearches: 6 });
  const verdict = parseJson(extractText(data));
  if (!verdict) return { pass: false, problems: ['The fact check did not return a usable verdict.'], claims: [] };

  const claims = arr(verdict.claims);
  const wrong = claims.filter((c) => String(c && c.verdict).toLowerCase() === 'wrong');
  const unverified = claims.filter((c) => String(c && c.verdict).toLowerCase() === 'unverified');

  const problems = [];
  for (const c of wrong.slice(0, 8)) {
    problems.push(`Wrong fact, fix or remove it: "${String(c.claim).slice(0, 200)}" (${String(c.note || '').slice(0, 150)})`);
  }
  // A couple of unverified specifics is normal. A pile of them means the piece
  // is asserting things nobody can stand behind.
  if (unverified.length > 4) {
    problems.push(`${unverified.length} specific claims could not be verified. Soften them into ranges, attribute them, or cut them.`);
    for (const c of unverified.slice(0, 5)) problems.push(`Unverified: "${String(c.claim).slice(0, 160)}"`);
  }

  return { pass: problems.length === 0, problems, claims, wrongCount: wrong.length, unverifiedCount: unverified.length };
}

// ── The revision pass ──────────────────────────────────────────────────────

/**
 * One chance to fix what the gates found. No web search: the writer already did
 * the research, and the problems are mostly about honesty and style, not facts
 * it needs to look up again. Wrong facts are removed rather than re-researched.
 */
export async function reviseDraft({ post, problems, callClaude, parseJson }) {
  const system = `You are revising your own draft for aasthachopra.com. An editor and a fact checker found the problems listed below. Fix every one of them.

Rules that do not change: no em dashes or en dashes, British spelling, money as "AED 280", the UAE working week is Monday to Friday, no year in the title, clean semantic HTML only (no h1, no inline styles, no images, no markdown), and no sentence copied from any source.

If a problem says a fact is wrong or unverified, do not go looking for a better number. Remove the specific claim, or turn it into a safe range and tell the reader to check the current figure.

If a problem says a first-person claim is unsupported, either remove that claim or rewrite it so it no longer says she was there.

Return ONLY the corrected JSON object with the same keys as before: title, slug, meta_description, excerpt, body_html, faq, seo_keywords, target_queries, instagram_refs, sources. No prose, no code fences.`;

  const user = `PROBLEMS TO FIX:
${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}

CURRENT DRAFT (JSON):
${JSON.stringify({
    title: post.title, slug: post.slug, meta_description: post.meta_description,
    excerpt: post.excerpt, body_html: post.body_html, faq: post.faq,
    seo_keywords: post.seo_keywords, target_queries: post.target_queries,
    instagram_refs: post.instagram_refs, sources: post.research_sources || post.sources,
  })}`;

  const data = await callClaude({ system, user, useTools: false, maxTokens: 8000 });
  const fixed = parseJson(extractText(data));
  return fixed && fixed.title && fixed.body_html ? fixed : null;
}

// ── Small shared helpers ───────────────────────────────────────────────────

function extractText(data) {
  let out = '';
  for (const b of (data && data.content) || []) if (b.type === 'text') out += b.text;
  return out;
}
function arr(x) { return Array.isArray(x) ? x : []; }
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

/** Pillar guides are allowed to be longer; used by the caller for context only. */
export const PILLAR_RANGE = { min: PILLAR_WORD_MIN, max: PILLAR_WORD_MAX };
