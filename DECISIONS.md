# Decisions

Short records of why the site is the way it is. Newest first.

## 2026-08-31 — One photo, one place: the de-duplication pass

The site had the same photos showing up all over: the angel-wings shoot in
three places, the ski photo twice on the wellness page, the rooftop and
race-car photos twice each on the luxury page, and near-identical frames from
the same shoot sitting side by side in galleries. Two "new" photos added on
31 Aug were actually re-uploads of photos already on the site under older
names (the G-Wagon shot ≈ `dubai-fashion-luxury-1`, the Burj jumpsuit ≈
`dubai-lifestyle`).

**Rule going forward: a photo appears at most once per page, and ideally once
across the homepage + three world pages.** Frames from the same shoot count
as the same photo for gallery purposes — pick the best one. Before adding
"new" photos, render a labeled contact sheet of `images/aastha-chopra-*.jpg`
and check the new files against it; several shoots already have 2–4 frames
in the folder.

Photos are placed by meaning, not just looks: the wellness "watch" cover is
the snow-robe shot because the reel beside it is a Swiss alpine hike; the
wellness story shows the Alo store visit because the text is about wellness
brands; the homepage "where to buy gold" tile shows the gold-lantern hotel
look. Same-shoot spares (`desert-editorial-2`, `floral-feather-evening-1`,
`dubai-polka-jumpsuit`, `dubai-lifestyle`, `dubai-fashion-luxury-1`,
`dubai-wellness-fitness-1`, `premium-beauty-dubai`, `fashion-editorial-dubai`,
the MAC spares, `madinat-jumeirah-dubai`) stay in the folder for the Journal
and future swaps — do not re-add them to galleries.

## 2026-08-31 — Strategy reset: the machine must follow Aastha, not run beside her

**The numbers, checked today (31 Aug).**

- The website gets 20–50 visits a week (Google's own count, June–August).
  Effectively nobody sees it.
- Instagram followers: 51,574 on 4 June → 51,848 on 31 Aug. Up 274 in three
  months. Flat.
- Ad spend: 0.00 AED every day for at least the last two weeks. No promotion
  is running at all.
- The daily pitch writer has produced 190 pitches since June. Exactly 2 ever
  reached a brand (both in June, in the old voice). The other 186 landed in
  Aastha's inbox as drafts. Of the last 30: 17 had **no contact address at
  all**, and 25 used the identical opening line ("Bringing X to life"). The
  rotation included Cadillac, Audi, Lucid and Visit Maldives — brands with
  near-zero chance of paying a 51k lifestyle creator for a cold email.
- Meanwhile, her own feed over the last 60 days shows roughly **14 real brand
  collaborations**: L'Occitane, Alo, Zara, Kosas, Elemis × Sephora Middle
  East, L'Oréal, Huda Beauty, JW PEI, an Ounass discount code (AH91), two
  fragrance houses, restaurants. She is doing the business herself, by hand.

**The root cause.** Every part of the system produces output from static
lists — a 185-brand watchlist, a blog topic queue — and none of it reads the
one live asset that matters: what Aastha just posted and who she actually
works with. All that evidence sits in our own database (posts sync every four
hours) and the pitch writer never looks at it. We measured activity (pitches
written, posts published) instead of outcomes (replies, deals, followers).

**The strategy: one loop, anchored on her feed.**

1. **Repeat-business engine — the fastest money.** About a week after each
   collab post, send that brand a results note with the real numbers (reach,
   views, saves) and one idea for the next piece. A brand she just tagged is
   the warmest lead that exists; nobody is following these up today.
2. **Sniper pitches instead of a rotation.** A pitch goes out only when three
   things line up: she posted in that category within 30 days (real proof to
   cite), we have a checked contact address, and ideally the brand is running
   UAE ads right now. Three to five a week, each citing the actual reel and
   its numbers. Never again a pitch with no address.
3. **A personal page per pitch.** Each pitch links to
   aasthachopra.com/for/(brand): her work in that brand's category, live
   numbers, similar past collabs, rates. A visit to that page tells us the
   brand is interested — that becomes the alert that matters. This is the
   website's real job: convincing brand managers, not chasing Google.
4. **Ads restart with one job: amplify the proven winner.** Put the paused
   ~50 AED/day behind her best reel of each week, shown to people who already
   engage with her and their lookalikes. When a collab happens, ask the brand
   about partnership ads (they often pay).
5. **The scoreboard becomes replies and deals**, plus follower change — not
   counts of things the machine produced.

**Done the same day (31 Aug).** The always-on promotion is back, boosting her
real posts (15 AED/day, the L'Occitane reel first). An Instagram-message pack
now lands in her inbox Mondays and Thursdays: three checked brands, written
messages, one tap opens the brand's chat, she sends from her own profile. Both
outreach channels now run through one shared accuracy engine: hard rules in
code (no invented sightings, no "worked with", no unapproved numbers) plus an
independent fact-check against the researched brand description; anything that
fails twice is dropped, never delivered.

**Stopped / demoted.**

- The three-drafts-a-day emails to Aastha stop — replaced the same day by at
  most five a week, one a day, and only for brands with a checked address, a
  researched description, and a category she actually creates in.
- Cold pitches to the auto/travel/luxury "reach" tier stop.
- The Journal keeps its current low cadence but gets no further investment:
  it has produced roughly zero readers, and it only started being measured on
  23 Aug. Revisit with data in a quarter.

## 2026-08-24 — Search engines: how the site actually gets submitted

**Google.** Its sitemap ping endpoint was deprecated in June 2023 and now 404s,
so the only routes are the `Sitemap:` line in robots.txt (passive) and Search
Console (active). The sitemap is submitted; it had been sitting on a 5 July
submission from before the content rebuild.

Search Console can be driven from this machine without a browser. The gcloud
service account `decifer-integrations@decifer-service-integrations.iam.gserviceaccount.com`
is a full user on the property:

```bash
TOK=$(gcloud auth print-access-token --scopes="https://www.googleapis.com/auth/webmasters")
SITE="https%3A%2F%2Fwww.aasthachopra.com%2F"
SM="https%3A%2F%2Fwww.aasthachopra.com%2Fsitemap.xml"
curl -s -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites/$SITE/sitemaps"
curl -s -X PUT -H "Authorization: Bearer $TOK" "https://www.googleapis.com/webmasters/v3/sites/$SITE/sitemaps/$SM"
```

Two traps, both of which produced a convincing but wrong "no access" reading
the first time this was tried:

- Calling `gcloud auth print-access-token` **without** `--scopes` returns a
  cloud-platform token, and Search Console answers
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. That is the token missing a scope, not the
  account missing permission.
- `--impersonate-service-account` is wrong here. The service account is already
  the active account, so impersonating it needs `serviceAccountTokenCreator` on
  itself. The `PERMISSION_DENIED` that follows looks like proof of no access.

**Bing, Yandex, Seznam, Naver.** IndexNow, no auth. Key
`b4bd21537f724b699428afa92452c614`, hosted at `/b4bd21537f724b699428afa92452c614.txt`.
`api/cron/generate-blog.js` pings it whenever a post publishes, and the full
URL list can be pushed at any time by POSTing `{host, key, keyLocation, urlList}`
to `https://api.indexnow.org/indexnow`.

**Baseline on the day of the rebuild** (28 days to 23 August, so before any
rewritten guide could rank): 8 clicks, 1,298 impressions, average position 50.6.
Worth comparing against in a few weeks.

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
