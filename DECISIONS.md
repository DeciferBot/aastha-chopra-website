# Decisions

Short records of why the site is the way it is. Newest first.

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
6. Automation: the cron now writes **drafts only** (Mon and Thu, 03:00 UTC).
   It receives the list of existing posts, refuses a duplicate topic (word
   overlap ≥ 0.6 with an existing title/queries), and must follow the house
   rules. The morning health check lists drafts older than two days with a
   preview link and a one-tap publish link (`api/blog-publish.js`, gated by
   `CRON_SECRET`). Nothing goes live without a person reading it.

**Rejected.** Keeping the cron on auto-publish with a better prompt. The prompt
was already decent; the failure was structural (no duplicate check, no review,
web-search output pasted as prose). A human gate is the only fix that holds.

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
