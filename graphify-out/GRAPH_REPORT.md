# Graph Report - .  (2026-08-31)

## Corpus Check
- 48 files · ~865,319 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 322 nodes · 637 edges · 26 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 127 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `text()` - 30 edges
2. `handler()` - 18 edges
3. `handler()` - 15 edges
4. `send()` - 13 edges
5. `handler()` - 13 edges
6. `sb()` - 13 edges
7. `handler()` - 12 edges
8. `renderArticle()` - 12 edges
9. `esc()` - 11 edges
10. `handler()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `text()` --calls--> `callClaude()`  [INFERRED]
  api/_blog-qa.js → api/cron/blog-audit.js
- `handler()` --calls--> `sb()`  [INFERRED]
  api/sitemap.js → api/cron/daily-brief.js
- `handler()` --calls--> `text()`  [INFERRED]
  api/invoice-save.js → api/_blog-qa.js
- `send()` --calls--> `handler()`  [INFERRED]
  api/telegram.js → api/blog-index.js
- `send()` --calls--> `handler()`  [INFERRED]
  api/telegram.js → api/blog.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.1
Nodes (37): alert(), callClaude(), handler(), handler(), arr(), editorGate(), extractText(), factGate() (+29 more)

### Community 1 - "Community 1"
Cohesion: 0.15
Nodes (36): attachInstagramImages(), ctaBlock(), dedupePostImages(), esc(), handler(), hashStr(), filterBar(), handler() (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (25): adArchive(), checkAdLibrary(), generateCheckedPitch(), handler(), resolveAdToken(), sb(), scoreBrand(), storePitch() (+17 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (25): currentActiveAds(), fbGet(), fbPost(), handler(), pickWinner(), sb(), buildTargeting(), fbDelete() (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (19): ruleGate(), text(), wordCount(), dayOnly(), daysAgo(), handler(), sb(), sendAlert() (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (2): barChart(), noBorder()

### Community 6 - "Community 6"
Cohesion: 0.25
Nodes (14): blockquote(), buildLightbox(), closeLightbox(), ensureEmbedScript(), esc(), init(), loadReels(), num() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.34
Nodes (14): handler(), emailPitchToAastha(), generatePitch(), handleAdd(), handleHelp(), handleLeadDone(), handleLeads(), handleList() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.32
Nodes (14): ensureHeroReels(), fetchCarouselChildren(), fetchDailySnapshot(), fetchDemographics(), fetchFollowsUnfollows(), fetchInsights(), fetchReachedDemographics(), fetchRecentMedia() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.27
Nodes (11): checkText(), mechanicalProblems(), unsupportedNumbers(), verifyClaims(), dedash(), generateCheckedDm(), generateDm(), handler() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.47
Nodes (8): buildTargeting(), cleanupOldCampaigns(), fbDelete(), fbGet(), fbPost(), handler(), resolveCarousel(), uploadImage()

### Community 11 - "Community 11"
Cohesion: 0.39
Nodes (7): handler(), mirror(), pendingCount(), pendingFilter(), publicUrl(), sb(), storageExists()

### Community 12 - "Community 12"
Cohesion: 0.32
Nodes (5): handler(), hash(), readFbCookies(), sendCapiEvent(), handler()

### Community 13 - "Community 13"
Cohesion: 0.46
Nodes (7): fbGet(), fbPost(), handler(), sbGet(), sbUpsert(), visitsFrom(), ymd()

### Community 14 - "Community 14"
Cohesion: 0.5
Nodes (6): cleanupOldCampaigns(), fbDelete(), fbGet(), fbPost(), findAudience(), handler()

### Community 15 - "Community 15"
Cohesion: 0.48
Nodes (5): fbGet(), handler(), sbGet(), sbUpsertDaily(), ymd()

### Community 16 - "Community 16"
Cohesion: 0.67
Nodes (5): fetchDemo(), handler(), ig(), sb(), sleep()

### Community 17 - "Community 17"
Cohesion: 0.5
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 0.67
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 19`** (2 nodes): `handler()`, `analytics-auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `invoice-auth.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `invoice-list.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `ig-profile.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `instagram.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `invoice-next.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `generate-pdf.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `text()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 7`, `Community 8`, `Community 9`, `Community 11`, `Community 13`, `Community 16`?**
  _High betweenness centrality (0.370) - this node is a cross-community bridge._
- **Why does `sb()` connect `Community 0` to `Community 1`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **Why does `handler()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Are the 27 inferred relationships involving `text()` (e.g. with `handler()` and `sb()`) actually correct?**
  _`text()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `handler()` (e.g. with `segmentMeta()` and `sb()`) actually correct?**
  _`handler()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `handler()` (e.g. with `sb()` and `attachInstagramImages()`) actually correct?**
  _`handler()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `send()` (e.g. with `handler()` and `handler()`) actually correct?**
  _`send()` has 3 INFERRED edges - model-reasoned connections that need verification._