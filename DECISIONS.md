# Decisions

Short records of why the site is the way it is. Newest first.

## 2026-08-24 — Journal auto-publishes, behind quality gates

**Problem.** After the rebuild below, the cron wrote drafts and waited for a
person. Nobody wants to read drafts. But the reason drafts existed was real:
the writer, left alone, had produced 64 posts with pasted marketing copy,
invented first-person experiences, wrong facts and repeated topics.

**Decision.** Auto-publish, but only what survives three gates. `api/_blog-qa.js`:

1. **Rules** (free, instant). Style and structure: no em dashes, no year in the
   title, no banned marketing words, word count, meta length, balanced HTML,
   internal links that point at published posts, Instagram references that are
   really hers, at least two credible sources, and a disclosure whenever the
   piece mentions gifted or partner product. Tested against the old corpus: it
   flags 57 of the 69 old posts and passes all 42 rewritten ones.
2. **Editor** (one Claude call, no tools). Scores five things out of five and
   needs 4+ on each: is it in its own words or lifted from a venue website, is
   every "I did this" backed by one of the supplied Instagram captions, does it
   answer its own title, does it contradict itself, is it a genuinely different
   question from what is already published.
3. **Facts** (one Claude call with web_search). Pulls out every checkable
   specific (prices, addresses, hours, directions, stats) and verifies. Any
   claim it can show is wrong blocks publication. More than four unverifiable
   specifics also blocks: a piece asserting things nobody can stand behind is
   the failure mode that produced the old posts.

Anything flagged gets **one revision pass**, then the gates run again. The
revision is told to remove or soften a bad fact rather than research a new one,
which is why the second pass can skip the fact gate and still fit in the
function's time budget.

**Fails closed.** If a gate errors, returns nonsense, or there is not enough
time left to run it, the post is not published. It is stored as `needs_work`,
which 404s and stays out of the sitemap. A post that never publishes costs
nothing; a wrong one costs the site's credibility.

**After publishing.** `api/cron/blog-audit.js` re-runs the fact gate weekly over
the least recently audited live posts, oldest first. Anything found plainly
wrong is pulled back to `needs_work` and emailed. This catches both the fact the
checker missed and the fact that has since gone stale, which is most prices and
opening hours.

**What the morning email says now.** Nothing to approve. It only speaks up if
the Journal has published nothing for ten days, if every recent run was
rejected, or if `needs_work` is piling up. All three mean the pipeline needs a
look, not a tap.

**Honest limit.** Rules and the editor are strong on style, pasted copy,
invented experience and duplication. The fact gate is good, not perfect: a
plausible wrong number with no clear source can still get through. The weekly
audit is the second net, and unpublishing is one API call.

## 2026-08-24 — Journal content overhaul

**Problem.** The Journal had 64 live posts, all written by the cron in
`api/cron/generate-blog.js`. Reading every one of them showed:

- The same question published up to three times (perfume longevity ×3, gold ×3,
  afternoon tea ×2, makeup melting ×2).
- Whole paragraphs pasted from hotel, spa, perfume-shop and retailer websites.
- Wrong facts: metro direction and abra landing for the Gold Souk, "the UAE
  working week is Sunday to Thursday" (it has been Monday to Friday since 2022),
  Jebel Jais height, the VAT rule on gold, which beaches allow night swimming.
- Posts contradicting each other (cream vs powder makeup, SPF reapplication
  time, drive times to the same places).
- First-person claims with nothing behind them ("I have rented dozens of cars",
  "I have done all of them"). Her real Instagram record was attached to posts
  but rarely used.
- Off-brand topics (used cars, car rental, package couriers, apartment
  cleaning) that dilute what Google thinks the domain is about.
- Google Analytics recorded zero Journal sessions because the blog shell never
  had the tag (fixed separately the same day). The `views` column shows 5 to 77
  per post, mostly crawlers. So the blog had nothing to lose from a rebuild.

**Decision.** Rebuild, do not patch.

1. 64 posts → 42 articles. 23 slugs became 301 redirects (`status = merged`,
   `redirect_to` set; `api/blog.js` serves the redirect). The map is at the
   end of this entry and in the database.
2. Every surviving article rewritten to one house style (see the system prompt
   in `generate-blog.js` for the rules): the answer first, real sub-questions
   as H2s, one section of genuine first-hand experience from the Instagram
   record, a "what I would skip" section, ranges instead of prices that go
   stale, no year in titles, British spelling, no dashes.
3. Transparency: a "How I work with brands" line sits under every post
   (`AUTHOR.disclosure` in `api/_blog.js`), and any gifted product or partner
   brand gets a one-line `<p class="bdisclosure">` inside the post.
4. Keyword demand checked with Google's UAE autocomplete (the same signal the
   generator uses). Titles now match what people type ("where to buy gold in
   dubai", "what to wear in dubai", "best spa in dubai for couples", "perfume
   souk dubai timings").
5. Site organisation: reader-facing section names (Shopping, Eat & Stay);
   the automobile pillar hidden from the Journal; each section's pillar guide
   pinned first; a static "From the Journal" block on the homepage linking the
   three strongest pillars and all eight sections; `llms.txt` updated.
6. Automation: the cron receives the list of existing posts and refuses a
   duplicate topic (word overlap >= 0.6 with an existing title/queries).
   It originally wrote drafts for a person to approve; that was replaced the
   same day by the quality gates described in the entry above, because nobody
   wants to read drafts.

**Rejected.** Keeping the cron on auto-publish with only a better prompt. The
prompt was already decent; the failure was structural (nothing checked the
output). The fix is a check, not better instructions. See the entry above for
the check that replaced the human one.

**Open.** The rewrites are grounded in Instagram captions, so a few venue
details that could not be verified online are written as "roughly" or "check
before you go". Aastha should skim the eight pillar guides and correct any
first-person line that is not quite how it happened.

Redirect map (old → new):
skincare-mistakes-in-dubai-climate, best-facials-in-dubai → best-skincare-routine-dubai-climate ·
best-makeup-for-hot-humid-weather-dubai → how-to-stop-makeup-melting-in-dubai-heat ·
how-to-use-cream-blush-stick-dubai → glowy-summer-makeup-look-dubai ·
best-middle-eastern-beauty-brands → where-to-buy-affordable-makeup-in-dubai ·
how-to-wear-gourmand-perfume-in-dubai → how-to-build-a-perfume-wardrobe-dubai ·
what-to-wear-in-dubai-summer, how-to-wear-a-straw-hat-in-dubai → what-to-wear-in-dubai ·
quiet-luxury-style-dubai, how-to-wear-sporty-luxe-in-dubai → how-to-dress-in-your-40s ·
how-to-choose-a-vegan-leather-bag-dubai → how-to-care-for-designer-bags-in-dubai ·
how-to-buy-gold-dubai-gold-souk-guide → where-to-buy-gold-in-dubai ·
how-to-buy-an-engagement-ring-in-dubai → how-to-buy-diamond-jewellery-in-dubai ·
best-couple-massage-dubai-prices → best-spas-in-dubai ·
high-protein-food-in-dubai → healthy-food-in-dubai ·
best-beach-in-dubai-for-couples → best-beaches-in-dubai ·
best-road-trips-from-dubai, how-to-rent-a-car-in-dubai, how-to-buy-a-used-car-in-dubai → best-day-trips-from-dubai ·
best-cars-for-dubai-summer-heat → things-to-do-in-dubai-in-summer ·
uk-summer-trip-from-dubai-with-family → what-to-pack-for-london-in-summer ·
how-to-send-a-package-in-dubai → best-malls-in-dubai ·
how-to-keep-your-dubai-apartment-clean → where-to-buy-home-decor-in-dubai.
