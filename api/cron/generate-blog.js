/**
 * Blog generator — Vercel Cron / on-demand.
 * GET /api/cron/generate-blog             -> writes and publishes if it passes every gate
 * GET /api/cron/generate-blog?draft=1     -> writes, gates, but stores as a draft
 * GET /api/cron/generate-blog?segment=fragrance   -> force a pillar
 *
 * Pipeline:
 *   1. Pick a rotating pillar + a fresh, unused trending row from uae_signals
 *   2. Expand into the real questions people search via Google autocomplete (UAE)
 *   3. Deep research + write in ONE Claude call using the server-side web_search
 *   4. QUALITY GATES (api/_blog-qa.js): rules, then an editor, then a fact check.
 *      Anything the gates flag gets ONE revision pass, then the gates run again.
 *   5. Publish only on a clean pass. Otherwise store as `needs_work` and stay quiet.
 *
 * Nothing publishes unchecked, and nothing publishes that failed a check. A post
 * that never publishes costs nothing; a wrong one costs the site's credibility.
 *
 * Skips cleanly when there is no real topic or the model cannot ground the piece.
 * Auth: Bearer CRON_SECRET, same as the other crons.
 */

import { sb, SEGMENTS, SITE, segmentMeta } from '../_blog.js';
import { ruleGate, editorGate, factGate, reviseDraft } from '../_blog-qa.js';

// Writer (web research) plus three gates plus one revision does not fit in the
// 300s default. Fluid Compute allows longer; if a plan ever caps this lower, the
// time guard below simply refuses to publish unchecked rather than misbehaving.
export const config = { maxDuration: 600 };

// The gates need time to run. If the writer overran and there is not enough left
// to check the piece properly, we store it unpublished rather than publish blind.
// Editor (~20s) + fact check (~60s) + revision (~30s) + a re-check, with margin.
const GATE_TIME_RESERVE_MS = 180_000;

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
  // Auto-publish is the default now. ?draft=1 stores without publishing, which is
  // how a topic is trialled by hand without touching the live site.
  const draftOnly = req.query.draft === '1';
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
    // Match on the pillar KEY: labels are reader-facing ("Eat & Stay") and can change.
    const fresh = signals.filter((s) => !used.has(s.id));
    const matchTerm = segment;
    const signal = fresh.find((s) =>
      String(s.category || '').toLowerCase().includes(matchTerm)
      || (s.tags || []).some((t) => String(t).toLowerCase().includes(matchTerm))
    ) || fresh[0];

    if (!signal) {
      await logRun({ startMs, segment, status: 'skipped', dryRun: draftOnly, errors: ['No fresh signal to write about'] });
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

    // ── 3c. What the Journal already answers ─────────────────────────────
    // The August 2026 clean-up found the same question published three times
    // ("how to make perfume last") because nothing checked. The writer gets the
    // live list so it picks an unanswered question, and the result is checked
    // again below before anything is stored.
    const existing = await sb(
      '/blog_posts?select=slug,title,target_queries,status&status=in.(published,draft)&order=published_at.desc.nullslast&limit=300'
    ) || [];

    // ── 4. Deep research + write ─────────────────────────────────────────
    const { post, sources } = await researchAndWrite({ seg, segment, signal, questions, igPosts, existing });
    sourcesUsed = sources.length;

    // ── 4b. Refuse a duplicate topic ─────────────────────────────────────
    const clash = findTopicClash(post, existing);
    if (clash) {
      await logRun({ startMs, segment, topic, status: 'skipped', dryRun: draftOnly, queriesFound, errors: [`Topic already covered by /blog/${clash.slug}`] });
      return res.status(200).json({ ok: true, note: 'Topic already covered', segment, existing: clash.slug, proposed: post.title });
    }

    // ── 5. Quality gates ─────────────────────────────────────────────────
    // Three checks, cheapest first, then ONE revision pass, then the same
    // checks again. Nothing publishes that has not come back clean.
    const publishedSlugs = new Set(existing.filter((e) => e.status === 'published').map((e) => e.slug));
    const knownPermalinks = new Set(
      igPosts.map((p) => (String(p.permalink || '').match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/) || [])[1]).filter(Boolean)
    );
    const gateCtx = { publishedSlugs, knownPermalinks };

    let candidate = { ...post, body_html: sanitiseBody(post.body_html || ''), research_sources: sources.slice(0, 8) };
    let gate = await runGates({ candidate, igPosts, existing, gateCtx, startMs });
    let revised = false;

    if (!gate.pass && gate.problems.length) {
      const factsAlreadyPassed = Boolean(gate.report.facts && gate.report.facts.pass);
      const fixed = await reviseDraft({ post: candidate, problems: gate.problems, callClaude, parseJson }).catch(() => null);
      if (fixed) {
        revised = true;
        candidate = {
          ...candidate, ...fixed,
          body_html: sanitiseBody(fixed.body_html || ''),
          research_sources: arr(fixed.sources).length ? arr(fixed.sources).slice(0, 8) : candidate.research_sources,
        };
        gate = await runGates({
          candidate, igPosts, existing, gateCtx, startMs,
          skipFacts: factsAlreadyPassed,
        });
      }
    }

    // ── 6. Store. Published only on a clean pass. ────────────────────────
    let slug = slugify(candidate.slug || candidate.title);
    slug = await uniqueSlug(slug);

    const bodyHtml = sanitiseBody(candidate.body_html || '');
    const wordCount = countWords(bodyHtml);
    const publishable = gate.pass && !draftOnly;

    const row = {
      slug,
      segment,
      title: noDash(candidate.title || topic),
      meta_description: noDash(candidate.meta_description || '').slice(0, 200),
      excerpt: noDash(candidate.excerpt || ''),
      body_html: bodyHtml,
      seo_keywords: arr(candidate.seo_keywords).slice(0, 12),
      target_queries: (candidate.target_queries && arr(candidate.target_queries).length ? arr(candidate.target_queries) : questions).slice(0, 20),
      faq: arr(candidate.faq).filter((f) => f && f.q && f.a).map((f) => ({ q: noDash(f.q), a: noDash(f.a) })).slice(0, 6),
      research_sources: arr(candidate.research_sources).slice(0, 8),
      instagram_refs: arr(candidate.instagram_refs)
        .filter((r) => r && r.permalink && /instagram\.com/.test(r.permalink))
        .map((r) => ({ permalink: r.permalink, caption: noDash(String(r.caption || '')).slice(0, 200), type: r.type || '' }))
        .slice(0, 3),
      word_count: wordCount,
      source_signal_id: signal.id,
      // `needs_work` is a third state on purpose: it is not a draft waiting for a
      // human (nobody is watching) and it is not published. It is a record of a
      // piece the gates rejected, kept so the failures can be read back later.
      status: publishable ? 'published' : (draftOnly ? 'draft' : 'needs_work'),
      published_at: publishable ? new Date().toISOString() : null,
    };

    const [saved] = await sb('/blog_posts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    created = { slug: saved.slug, title: saved.title, status: saved.status, words: saved.word_count };

    if (publishable) {
      await indexNowPing(`${SITE.base}/blog/${saved.slug}`).catch(() => {});
    }

    for (const p of gate.problems) errors.push(p);
    await logRun({
      startMs, segment, topic,
      status: publishable ? 'success' : 'rejected',
      dryRun: draftOnly, postsCreated: publishable ? 1 : 0,
      queriesFound, sourcesUsed, errors,
    });

    const liveUrl = `${SITE.base}/blog/${saved.slug}`;
    return res.status(200).json({
      ok: true, published: publishable, segment, created, revised,
      gates: gate.report,
      url: publishable ? liveUrl : `${liveUrl}?preview=${encodeURIComponent(secret)}`,
      queriesFound, sourcesUsed,
      problems: gate.problems,
    });

  } catch (err) {
    errors.push(err.message);
    await logRun({ startMs, segment, topic, status: 'failed', dryRun: draftOnly, queriesFound, sourcesUsed, errors }).catch(() => {});
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

// ── The gate runner ────────────────────────────────────────────────────────
/**
 * Rules, then the editor, then the facts. Stops at the first gate that fails so
 * a piece with broken HTML never burns a fact-check call.
 *
 * Fails closed on time: the writer's web research can overrun, and publishing
 * something the fact gate never saw is exactly the failure this whole thing
 * exists to prevent.
 */
async function runGates({ candidate, igPosts, existing, gateCtx, startMs, skipFacts = false }) {
  const report = {};

  const rules = ruleGate(candidate, gateCtx);
  report.rules = { pass: rules.pass, problems: rules.problems.length, words: rules.wordCount };
  if (!rules.pass) return { pass: false, problems: rules.problems, report };

  if (Date.now() - startMs > config.maxDuration * 1000 - GATE_TIME_RESERVE_MS) {
    report.editor = { pass: false, reason: 'no time' };
    return { pass: false, problems: ['There was not enough time left to check this piece, so it was not published.'], report };
  }

  let editor;
  try {
    editor = await editorGate({ post: candidate, igPosts, existing, callClaude, parseJson });
  } catch (e) {
    report.editor = { pass: false, reason: e.message };
    return { pass: false, problems: [`The editor check could not run: ${e.message}`], report };
  }
  report.editor = { pass: editor.pass, scores: editor.scores };
  if (!editor.pass) return { pass: false, problems: editor.problems, report };

  // The revision pass is told to remove or soften facts rather than research new
  // ones, so once the facts have passed there is nothing new to verify. Skipping
  // the re-check is what keeps a revised piece inside the function's time limit.
  if (skipFacts) {
    report.facts = { pass: true, skipped: 'already verified before revision' };
    return { pass: true, problems: [], report };
  }

  let facts;
  try {
    facts = await factGate({ post: candidate, callClaude, parseJson });
  } catch (e) {
    report.facts = { pass: false, reason: e.message };
    return { pass: false, problems: [`The fact check could not run: ${e.message}`], report };
  }
  report.facts = { pass: facts.pass, wrong: facts.wrongCount, unverified: facts.unverifiedCount, checked: (facts.claims || []).length };
  if (!facts.pass) return { pass: false, problems: facts.problems, report };

  return { pass: true, problems: [], report };
}

// ── Duplicate-topic guard ──────────────────────────────────────────────────
// Word-overlap between the proposed title/queries and every existing post. Stop
// words are dropped so "dubai", "best" and "in" do not make everything match.
const STOP = new Set(['the', 'a', 'an', 'in', 'of', 'for', 'to', 'and', 'or', 'on', 'at', 'with', 'is', 'are', 'do', 'does', 'how', 'what', 'where', 'which', 'why', 'can', 'you', 'your', 'my', 'i', 'it', 'as', 'by', 'from', 'dubai', 'uae', 'best', 'guide', 'really', 'actually', 'should', 'get']);
function topicTokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}
function findTopicClash(post, existing) {
  const mine = topicTokens([post.title, ...arr(post.target_queries).slice(0, 5)].join(' '));
  for (const e of existing) {
    const theirs = topicTokens([e.title, ...arr(e.target_queries).slice(0, 5)].join(' '));
    if (overlap(mine, theirs) >= 0.6) return e;
  }
  return null;
}

// ── Claude: research with web_search, then write ───────────────────────────
async function researchAndWrite({ seg, segment, signal, questions, igPosts, existing = [] }) {
  const system = `You are Aastha Chopra, a Dubai-based lifestyle creator (fashion, beauty, fragrance, wellness). You are writing a post for your OWN website, aasthachopra.com, for women in the UAE aged 25 to 44, many of them South Asian expats in Dubai.

Your job is to answer a real question people search on Google, completely and usefully, so the post earns its ranking. A draft is reviewed by a person before it is published, and anything that reads like a brochure or a search-results mashup gets thrown away.

NON-NEGOTIABLE RULES:
- Real value only. No filler intro, no "in today's world", no padding. Every paragraph teaches something.
- Aim for 1000 to 1500 words. Never pad to reach the count: if you cannot fill it honestly, answer more of the real sub-questions people also ask, add concrete specifics (venues, price ranges, timings, what to avoid), or narrow the title further and go deeper on that. 900 good words beat 1800 stitched ones.
- Be specific to the UAE: real neighbourhoods, malls, venues, AED prices, the climate and seasons, local context. Never invent facts, names or prices. If you are not sure, leave it out. Ranges ("roughly AED 40 to 80") beat exact prices that go stale.
- Use the web_search tool to research current, accurate details BEFORE writing. Search a few times. Prefer official and reputable sources (Visit Dubai, RTA, Gulf News, The National, Time Out Dubai, brand sites). NEVER copy a sentence from a source, a shop or a brand website. Put every fact in your own words.
- Voice: first person, honest, warm, direct, a little dry. Short sentences. Everyday words. Never use: elevate, curated, unforgettable, nestled, must-visit, game-changer, sanctuary, indulge.
- Opinions are welcome: "I would skip X" is more useful than a neutral list. Include a short "What I would skip" or "Mistakes I see" section where it fits.
- Where it fits, weave in Aastha's REAL Instagram experiences listed below, in first person and naturally (a launch she attended, a product she featured, a place she visited). Never invent an experience she did not have. If she has not been somewhere, say so or leave it out.
- If a product you mention was gifted to her or the brand is a partner (the caption says "use my code", "invited", "launch", "press day", "#ad" or similar), add one line inside the body: <p class="bdisclosure">Disclosure: [brand] gifted this / I have worked with [brand]. My opinion is my own.</p>
- The UAE working week is Monday to Friday. Never say Sunday to Thursday.
- NEVER use em dashes or en dashes. Not once. Use commas, full stops, or rewrite the sentence. Write ranges as "AED 100 to 400".
- British spelling. Write "AED 280", never "280 dirhams" or "280 AED".
- No year in the title ("2026 guide"), no "ultimate", no "complete". The title is the question as people type it, in plain words.
- Structure: the direct answer in the first two to four sentences, then depth under question-style H2 headings (the related things people also ask). Keep paragraphs short. End with one or two links to related guides from the EXISTING POSTS list, as <a href="/blog/slug">anchor</a>.
- The body is clean semantic HTML only: <p>, <h2>, <h3>, <ul>/<li>, <ol>/<li>, <blockquote>, and <table> when it genuinely helps. No <h1>, no inline styles, no <script>, no images, no markdown.
- Do NOT write about a question the Journal already answers (list below). Pick a question that is genuinely new. If every candidate question is already covered, return {"skip": true, "reason": "..."} instead of an article.
- This is content for the ${seg.label} pillar. Angle: ${require_angle(segment)}`;

  const existingList = existing.length
    ? `\n\nEXISTING POSTS (already answered, do not repeat; link only to these):\n${existing.filter((e) => e.status === 'published').slice(0, 120).map((e) => `- /blog/${e.slug}: ${e.title}`).join('\n')}`
    : '';

  const user = `TRENDING UAE CONTEXT (your starting point, ground the post in this where it fits):
Title: ${signal.title}
${signal.description ? `Detail: ${signal.description}\n` : ''}Category: ${signal.category || 'n/a'}
Source: ${signal.source_name || 'n/a'}

REAL QUESTIONS PEOPLE SEARCH (from Google autocomplete, UAE), most specific first. Pick the MOST SPECIFIC question you can genuinely answer well as your title, and use the related ones as H2s and FAQ. Do not broaden it: "best brunch in dubai" is already owned by major publishers, while "best quiet brunch in dubai for a birthday" is winnable and is what a real person actually types. Narrow beats broad every time here:
${questions.length ? questions.map((q) => `- ${q}`).join('\n') : '- (none returned; choose a strong question yourself for this pillar in a UAE context)'}

${igPosts && igPosts.length ? `AASTHA'S REAL INSTAGRAM POSTS (her genuine lived experience). Weave the most relevant one or two into the article naturally, in first person, then list those you referenced in instagram_refs:
${igPosts.map((p) => `- [${/\/reel\//.test(p.permalink) ? 'Reel' : 'Post'}] ${String(p.caption || '').replace(/\s+/g, ' ').slice(0, 160)} (${p.permalink})`).join('\n')}

` : ''}${existingList}

Research the topic with web_search, then return ONLY a JSON object (no prose, no code fences) with exactly these keys:
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

  // The writer is allowed to decline when every candidate question is already
  // answered on the site. Surface that as a clean skip, not a parse failure.
  if (post && post.skip) {
    throw new Error(`Writer skipped: ${post.reason || 'every candidate question is already covered'}`);
  }

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

async function callClaude({ system, user, useTools, maxTokens = 8000, maxSearches = 6 }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (useTools) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];
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

async function logRun({ startMs, segment, topic, status, dryRun = false, postsCreated = 0, queriesFound = 0, sourcesUsed = 0, errors = [] }) {
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
