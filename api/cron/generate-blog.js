/**
 * Blog generator — Vercel Cron / on-demand.
 * GET /api/cron/generate-blog        -> dry run, writes ONE draft, publishes nothing
 * GET /api/cron/generate-blog?publish=1   -> writes and publishes (used by the live cron)
 * GET /api/cron/generate-blog?segment=fragrance   -> force a pillar
 *
 * Pipeline:
 *   1. Pick a rotating pillar + a fresh, unused trending row from uae_signals
 *   2. Expand into the real questions people search via Google autocomplete (UAE)
 *   3. Deep research + write in ONE Claude call using the server-side web_search
 *      tool (multi-source, the cron-viable equivalent of the deep-research skill)
 *   4. Sanitise to the locked voice (no em dashes, no <h1>, no scripts) and store
 *
 * Skips cleanly when there is no real topic or the model cannot ground the piece.
 * Auth: Bearer CRON_SECRET, same as the other crons.
 */

import { sb, SEGMENTS, SITE, segmentMeta } from '../_blog.js';

export const config = { maxDuration: 300 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SEG_KEYS = Object.keys(SEGMENTS);

// IndexNow key (also hosted at /<KEY>.txt). Pings Bing/Yandex on publish for
// near-instant discovery. Google does not use IndexNow; it relies on the sitemap.
const INDEXNOW_KEY = 'b4bd21537f724b699428afa92452c614';

// Autocomplete PREFIXES per pillar, not finished queries.
//
// The earlier list aimed straight at head terms ("where to buy gold in dubai",
// "best brunch in dubai") that Time Out, Gulf News and Visit Dubai have owned
// for years with domain authority a new blog cannot match, so those posts had
// no realistic path to page one.
//
// Each string below is instead a stem Google will complete. Feeding it to
// autocomplete harvests the real long-tail queries hanging off it — "best
// brunch in dubai" becomes "best brunch in dubai for families", "for kids",
// "for couples" — which is what people actually type and what a first-hand
// UAE blog can win. Every prefix here was checked against the UAE-locale
// endpoint and returns at least three five-word-or-longer completions; stems
// that returned nothing were dropped rather than guessed at.
//
// Because these are prefixes, they are deliberately NOT added to the candidate
// title pool: "best facial in dubai for" is a fragment, not a headline.
const CURATED_SEEDS = {
  fashion:     ['what to wear to a wedding in dubai', 'where to buy abaya in dubai for', 'what to wear in dubai in summer as'],
  beauty:      ['best facial in dubai for', 'best sunscreen in dubai for', 'how to stop makeup melting in', 'best dermatologist in dubai for'],
  fragrance:   ['how to make perfume last', 'best oud perfume for', 'best perfume in dubai for', 'how to layer perfume', 'where to buy original perfume in dubai'],
  jewellery:   ['how to buy gold in dubai souk', 'is gold cheaper in dubai than', 'how to clean gold jewellery at home', '21k vs 22k gold'],
  wellness:    ['best gym in dubai for', 'best spa in dubai for', 'best massage in dubai for', 'best reformer pilates in dubai', 'best wellness retreat in the uae'],
  hospitality: ['best brunch in dubai for', 'best staycation in dubai for', 'best afternoon tea in dubai for', 'best pool day pass in dubai', 'best vegetarian restaurant in dubai for'],
  travel:      ['best beach in dubai for', 'ras al khaimah vs', 'places to visit near dubai in'],
  retail:      ['where to buy indian clothes in dubai', 'best outlet mall in dubai for', 'where to buy gifts in dubai', 'cheapest place to buy in dubai', 'best place to buy home decor in dubai'],
};

// Pillars the blog writes for. Deliberately excludes `automobile`: car hire and
// used car buying guides sit far outside a fashion and beauty creator's remit,
// and scattering the site across unrelated subjects weakens the topical
// authority Google uses to decide what this domain is actually about.
const BLOG_PILLARS = SEG_KEYS.filter((k) => k !== 'automobile');

/** Words in a search phrase. Used as the long-tail proxy: more words, less competition.
 *  Named distinctly from the local `wordCount` the handler computes for body copy. */
const phraseWords = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

export default async function handler(req, res) {
  // Cron uses the Bearer header; ?key= lets it be triggered by tapping a link
  // from a phone during the dry-run review phase. Both gate on CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  const authed = req.headers.authorization === `Bearer ${secret}` || (secret && req.query.key === secret);
  if (!authed) {
    return res.status(401).end();
  }

  const startMs = Date.now();
  const dryRun = req.query.publish !== '1';
  const errors = [];
  let segment = String(req.query.segment || '').toLowerCase();
  let topic = null;
  let queriesFound = 0;
  let sourcesUsed = 0;
  let created = null;

  try {
    // ── 1. Pillar (rotates by day so every segment gets covered) ──────────
    if (!SEGMENTS[segment]) {
      const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
      segment = BLOG_PILLARS[doy % BLOG_PILLARS.length];
    }
    const seg = segmentMeta(segment);

    // ── 2. Fresh, unused trending signal ─────────────────────────────────
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const signals = await sb(
      `/uae_signals?select=id,title,description,category,tags,source_name`
      + `&scraped_at=gte.${since}&order=relevance_score.desc&limit=30`
    ) || [];

    const usedRows = await sb('/blog_posts?select=source_signal_id') || [];
    const used = new Set(usedRows.map((r) => r.source_signal_id).filter(Boolean));

    // Prefer a signal whose category/tags match the pillar; fall back to top unused.
    const fresh = signals.filter((s) => !used.has(s.id));
    const matchTerm = seg.label.toLowerCase();
    const signal = fresh.find((s) =>
      String(s.category || '').toLowerCase().includes(matchTerm)
      || (s.tags || []).some((t) => String(t).toLowerCase().includes(matchTerm))
    ) || fresh[0];

    if (!signal) {
      await logRun({ startMs, segment, status: 'skipped', dryRun, errors: ['No fresh signal to write about'] });
      return res.status(200).json({ ok: true, note: 'No fresh signal', segment });
    }
    topic = signal.title;

    // ── 3. Real questions from Google autocomplete (UAE locale) ───────────
    const curated = CURATED_SEEDS[segment] || [];
    // Expand only from the curated long-tail seeds. The previous generic stems
    // ("best <pillar> dubai", "<pillar> dubai") pulled Google's most-searched
    // head terms into the list, which is precisely the competition a new blog
    // has no path to beat.
    // Seeds are prefixes, so only their completions are candidate titles.
    const suggestions = new Set();
    for (const seed of curated) {
      for (const s of await autocomplete(seed)) {
        // Five words or more keeps the tail long: "best brunch dubai" is out,
        // "best brunch in dubai for families" is in.
        if (phraseWords(s) >= 5) suggestions.add(s);
      }
    }
    const questions = [...suggestions]
      .filter((s) => /\b(how|what|where|which|why|is|are|can|do|does|best|cost|price)\b/i.test(s))
      // Most specific first, so the title the model picks comes from the tail.
      .sort((a, b) => phraseWords(b) - phraseWords(a))
      .slice(0, 25);
    queriesFound = questions.length;

    // ── 3b. Aastha's real Instagram posts for this pillar (lived experience) ──
    const igPosts = await fetchInstagramContext(segment);

    // ── 4. Deep research + write ─────────────────────────────────────────
    const { post, sources } = await researchAndWrite({ seg, segment, signal, questions, igPosts });
    sourcesUsed = sources.length;

    // ── 5. Sanitise + dedupe slug ────────────────────────────────────────
    let slug = slugify(post.slug || post.title);
    slug = await uniqueSlug(slug);

    const bodyHtml = sanitiseBody(post.body_html || '');
    const wordCount = countWords(bodyHtml);

    if (wordCount < 350) {
      errors.push(`Thin draft (${wordCount} words), storing anyway for review`);
    }

    const row = {
      slug,
      segment,
      title: noDash(post.title || topic),
      meta_description: noDash(post.meta_description || '').slice(0, 200),
      excerpt: noDash(post.excerpt || ''),
      body_html: bodyHtml,
      seo_keywords: arr(post.seo_keywords).slice(0, 12),
      target_queries: (post.target_queries && arr(post.target_queries).length ? arr(post.target_queries) : questions).slice(0, 20),
      faq: arr(post.faq).filter((f) => f && f.q && f.a).map((f) => ({ q: noDash(f.q), a: noDash(f.a) })).slice(0, 6),
      research_sources: sources.slice(0, 8),
      instagram_refs: arr(post.instagram_refs)
        .filter((r) => r && r.permalink && /instagram\.com/.test(r.permalink))
        .map((r) => ({ permalink: r.permalink, caption: noDash(String(r.caption || '')).slice(0, 200), type: r.type || '' }))
        .slice(0, 3),
      word_count: wordCount,
      source_signal_id: signal.id,
      status: dryRun ? 'draft' : 'published',
      published_at: dryRun ? null : new Date().toISOString(),
    };

    const [saved] = await sb('/blog_posts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    created = { slug: saved.slug, title: saved.title, status: saved.status, words: saved.word_count };

    // Ping IndexNow (Bing/Yandex) on publish for near-instant discovery. Non-blocking.
    if (!dryRun) {
      await indexNowPing(`${SITE.base}/blog/${saved.slug}`).catch(() => {});
    }

    await logRun({
      startMs, segment, topic, status: errors.length ? 'partial' : 'success',
      dryRun, postsCreated: 1, queriesFound, sourcesUsed, errors,
    });

    // Caller already proved the secret, so hand back a directly tappable link:
    // drafts need the preview token, published posts are public.
    const liveUrl = `${SITE.base}/blog/${saved.slug}`;
    const previewUrl = dryRun ? `${liveUrl}?preview=${encodeURIComponent(secret)}` : liveUrl;
    return res.status(200).json({
      ok: true, dryRun, segment, created,
      preview: previewUrl,
      queriesFound, sourcesUsed, errors,
    });

  } catch (err) {
    errors.push(err.message);
    await logRun({ startMs, segment, topic, status: 'failed', dryRun, queriesFound, sourcesUsed, errors }).catch(() => {});
    return res.status(500).json({ ok: false, error: err.message, segment });
  }
}

// ── Google autocomplete (UAE) ──────────────────────────────────────────────
async function autocomplete(query) {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=ae&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

// ── Aastha's Instagram (lived-experience grounding) ────────────────────────
const SEGMENT_IG_KEYWORDS = {
  fashion:     ['outfit', 'fashion', 'style', 'abaya', 'wear', 'dress', 'linen'],
  beauty:      ['skincare', 'beauty', 'makeup', 'glow', 'facial', 'spf', 'lip'],
  fragrance:   ['perfume', 'fragrance', 'oud', 'scent', 'kayali', 'ajmal'],
  jewellery:   ['jewellery', 'jewelry', 'gold', 'diamond', 'jewels'],
  wellness:    ['yoga', 'gym', 'fitness', 'workout', 'padel', 'protein', 'wellness'],
  hospitality: ['brunch', 'restaurant', 'dinner', 'dining', 'feast', 'hotel', 'suhoor'],
  travel:      ['travel', 'trip', 'staycation', 'hotel', 'hike', 'getaway', 'beach'],
  automobile:  ['car', 'drive', 'road trip'],
  retail:      ['shopping', 'mall', 'haul', 'pop-up', 'store'],
};

// Pull her highest-engagement posts whose captions match the pillar, so the
// writer can ground the article in things she has genuinely done.
async function fetchInstagramContext(segment) {
  const kws = SEGMENT_IG_KEYWORDS[segment] || [segment];
  const orFilter = kws.map((k) => `caption.ilike.*${encodeURIComponent(k)}*`).join(',');
  try {
    const rows = await sb(
      `/instagram_posts?select=permalink,caption,media_type,total_interactions`
      + `&caption=not.is.null&or=(${orFilter})`
      + `&order=total_interactions.desc.nullslast&limit=8`
    ) || [];
    return rows.filter((r) => r.permalink && r.caption);
  } catch {
    return [];
  }
}

// ── IndexNow (Bing/Yandex) ─────────────────────────────────────────────────
async function indexNowPing(url) {
  await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: 'www.aasthachopra.com',
      key: INDEXNOW_KEY,
      keyLocation: `${SITE.base}/${INDEXNOW_KEY}.txt`,
      urlList: [url],
    }),
  });
}

// ── Claude: research with web_search, then write ───────────────────────────
async function researchAndWrite({ seg, segment, signal, questions, igPosts }) {
  const system = `You are Aastha Chopra, a Dubai-based lifestyle creator (fashion, beauty, fragrance, wellness). You are writing a post for your OWN website, aasthachopra.com, for women in the UAE aged 25 to 44, many of them South Asian expats in Dubai.

Your job is to answer a real question people search on Google, completely and usefully, so the post earns its ranking.

NON-NEGOTIABLE RULES:
- Real value only. No filler intro, no "in today's world", no padding. Every paragraph teaches something.
- Depth wins rankings. Aim for 1400 to 1800 words. Posts of 700 words do not outrank an established guide on the same question. Never pad to reach the count: if you cannot fill it honestly, answer more of the real sub-questions people also ask, add concrete specifics (venues, price ranges, timings, what to avoid), or narrow the title further and go deeper on that.
- Be specific to the UAE: real neighbourhoods, malls, venues, AED prices, the climate and seasons, local context. Never invent facts, names or prices. If you are not sure, leave it out.
- Use the web_search tool to research current, accurate details BEFORE writing. Search a few times. Prefer recent, reputable sources.
- Voice: first person, honest, warm, confident, a little personal. Write like a real person talking, not a brand.
- Where it fits, weave in Aastha's REAL Instagram experiences listed below, in first person and naturally (a launch she attended, a product she featured, a place she visited). Never invent an experience she did not have.
- NEVER use em dashes. Not once. Use commas, full stops, or rewrite the sentence.
- Structure: a short direct answer first, then depth under question-style H2 headings (the related things people also ask). Keep paragraphs short.
- The body is clean semantic HTML only: <p>, <h2>, <h3>, <ul>/<li>, <ol>/<li>, <blockquote>, and <table> when it genuinely helps. No <h1>, no inline styles, no <script>, no images, no markdown.
- This is content for the ${seg.label} pillar. Angle: ${require_angle(segment)}`;

  const user = `TRENDING UAE CONTEXT (your starting point, ground the post in this where it fits):
Title: ${signal.title}
${signal.description ? `Detail: ${signal.description}\n` : ''}Category: ${signal.category || 'n/a'}
Source: ${signal.source_name || 'n/a'}

REAL QUESTIONS PEOPLE SEARCH (from Google autocomplete, UAE), most specific first. Pick the MOST SPECIFIC question you can genuinely answer well as your title, and use the related ones as H2s and FAQ. Do not broaden it: "best brunch in dubai" is already owned by major publishers, while "best quiet brunch in dubai for a birthday" is winnable and is what a real person actually types. Narrow beats broad every time here:
${questions.length ? questions.map((q) => `- ${q}`).join('\n') : '- (none returned; choose a strong question yourself for this pillar in a UAE context)'}

${igPosts && igPosts.length ? `AASTHA'S REAL INSTAGRAM POSTS (her genuine lived experience). Weave the most relevant one or two into the article naturally, in first person, then list those you referenced in instagram_refs:
${igPosts.map((p) => `- [${/\/reel\//.test(p.permalink) ? 'Reel' : 'Post'}] ${String(p.caption || '').replace(/\s+/g, ' ').slice(0, 160)} (${p.permalink})`).join('\n')}

` : ''}Research the topic with web_search, then return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
  "title": "the question as people type it",
  "slug": "kebab-case-url-slug",
  "meta_description": "150 to 160 characters, compelling, includes the key phrase",
  "excerpt": "one or two sentence direct answer shown at the top",
  "body_html": "the full article as clean HTML, no h1",
  "faq": [{"q":"question","a":"answer"}],
  "seo_keywords": ["keyword", "..."],
  "target_queries": ["the real queries this post targets"],
  "instagram_refs": [{"permalink":"https://www.instagram.com/reel/...","caption":"short caption snippet","type":"Reel"}],
  "sources": [{"title":"source title","url":"https://..."}]
}`;

  let data;
  try {
    data = await callClaude({ system, user, useTools: true });
  } catch (e) {
    // Fallback: still produce a draft for review, flagged by empty sources.
    data = await callClaude({ system: system + '\n(Note: web_search unavailable, write from reliable knowledge and do not invent specifics.)', user, useTools: false });
  }

  const { text, sources: citedSources } = extractTextAndSources(data);
  let post = parseJson(text);

  // The model occasionally wraps, truncates, or slightly malforms the JSON
  // (unescaped quotes in HTML attributes, a body cut off at max_tokens). One
  // cheap no-web-search repair pass rescues those runs instead of losing them.
  if (!post || !post.title || !post.body_html) {
    post = await repairJson(text).catch(() => null);
  }

  if (!post || !post.title || !post.body_html) {
    const stop = data && data.stop_reason ? ` stop_reason=${data.stop_reason}` : '';
    const tail = String(text || '').replace(/\s+/g, ' ').slice(-200);
    throw new Error(`Model did not return usable post JSON (len=${(text || '').length}${stop}; tail: ${tail})`);
  }

  // Merge model-declared sources with real citation URLs from the search results.
  const map = new Map();
  for (const s of [...arr(post.sources), ...citedSources]) {
    if (s && s.url) map.set(s.url, { url: s.url, title: s.title || s.url });
  }
  return { post, sources: [...map.values()] };
}

function require_angle(segment) {
  const ANGLES = {
    fashion: 'style pieces into real Dubai life so clothes read as worn and wanted',
    beauty: 'honest daily use, the texture and wear that make a beauty audience trust you',
    fragrance: 'scent as a feeling and a memory, the way Gulf fragrance lovers think about it',
    jewellery: 'the moments and occasions a piece is worn for, so it carries meaning',
    wellness: 'a believable daily routine that reads as part of real life',
    hospitality: 'a stay or a meal your reader wants to recreate',
    travel: 'a destination built into a story with a clear arc people can plan',
    automobile: 'the car inside an aspirational lifestyle, not a spec sheet',
    retail: 'a wide range made personal and shoppable across everyday city life',
  };
  return ANGLES[segment] || 'real, useful, Dubai-grounded storytelling';
}

async function callClaude({ system, user, useTools, maxTokens = 8000 }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (useTools) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic: ${await res.text()}`);
  return res.json();
}

function extractTextAndSources(data) {
  let text = '';
  const src = new Map();
  for (const b of data.content || []) {
    if (b.type === 'text') {
      text += b.text;
      for (const c of b.citations || []) {
        if (c.url) src.set(c.url, { url: c.url, title: c.title || c.url });
      }
    } else if (b.type === 'web_search_tool_result') {
      for (const r of b.content || []) {
        if (r && r.url) src.set(r.url, { url: r.url, title: r.title || r.url });
      }
    }
  }
  return { text, sources: [...src.values()] };
}

function parseJson(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = t.slice(start, end + 1);
  // 1. straight parse
  try { return JSON.parse(slice); } catch { /* fall through */ }
  // 2. the common breaker: literal newlines/tabs/control chars left unescaped
  //    inside a string value (models pretty-print body_html with real newlines).
  try { return JSON.parse(escapeControlCharsInStrings(slice)); } catch { /* fall through */ }
  return null;
}

// Walk the text tracking string vs structure, and escape any control character
// that appears literally inside a JSON string. Leaves already-escaped sequences
// and all structural characters untouched.
function escapeControlCharsInStrings(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
    }
    out += ch;
  }
  return out;
}

// Backstop for responses that parseJson could not salvage (unescaped quotes in
// HTML attributes, a truncated tail). Ask the model to emit strict JSON only.
// No web_search, so it is cheap and fast.
async function repairJson(text) {
  if (!text || text.length < 20) return null;
  const data = await callClaude({
    system: 'You convert almost-JSON into strict, valid JSON. Output ONLY the corrected JSON object: no code fences, no commentary. Preserve all content verbatim. Properly escape every character that must be escaped inside a JSON string (double quotes, backslashes, newlines, tabs). If the input was cut off mid-object, complete it minimally so it parses.',
    user: `Fix this into one valid JSON object:\n\n${String(text).slice(0, 100000)}`,
    useTools: false,
  });
  const { text: fixed } = extractTextAndSources(data);
  return parseJson(fixed);
}

// ── Sanitisers ──────────────────────────────────────────────────────────────
function noDash(s) {
  return String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();
}
function sanitiseBody(html) {
  return noDash(
    String(html)
      .replace(/<h1[\s\S]*?<\/h1>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/ style="[^"]*"/gi, '')
      .replace(/^```(?:html)?/i, '')
      .replace(/```$/, '')
  ).trim();
}
function countWords(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}
async function uniqueSlug(base) {
  let slug = base || 'post';
  for (let i = 0; i < 12; i++) {
    const rows = await sb(`/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=slug&limit=1`);
    if (!rows || !rows.length) return slug;
    slug = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}
function arr(x) { return Array.isArray(x) ? x : []; }

async function logRun({ startMs, segment, topic, status, dryRun, postsCreated = 0, queriesFound = 0, sourcesUsed = 0, errors = [] }) {
  await sb('/blog_agent_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      segment, topic, status, dry_run: dryRun,
      posts_created: postsCreated, queries_found: queriesFound, sources_used: sourcesUsed,
      errors, duration_ms: Date.now() - startMs,
    }),
  });
}
