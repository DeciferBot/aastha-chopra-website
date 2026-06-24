# Graph Report - .  (2026-06-25)

## Corpus Check
- 36 files · ~1,086,276 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 252 nodes · 463 edges · 25 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `handler()` - 14 edges
2. `send()` - 13 edges
3. `handler()` - 12 edges
4. `handler()` - 12 edges
5. `handler()` - 11 edges
6. `esc()` - 11 edges
7. `handler()` - 10 edges
8. `sb()` - 10 edges
9. `segmentMeta()` - 9 edges
10. `sb()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `urlEntry()` --calls--> `esc()`  [INFERRED]
  api/sitemap.js → api/_pitch.js
- `handler()` --calls--> `sb()`  [INFERRED]
  api/sitemap.js → api/cron/daily-brief.js
- `send()` --calls--> `handler()`  [INFERRED]
  api/telegram.js → api/blog-index.js
- `send()` --calls--> `handler()`  [INFERRED]
  api/telegram.js → api/blog.js
- `handler()` --calls--> `sb()`  [INFERRED]
  api/blog-index.js → api/cron/daily-brief.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (25): attachInstagramImages(), ctaBlock(), esc(), handler(), filterBar(), handler(), renderHomeView(), renderSegmentView() (+17 more)

### Community 1 - "Community 1"
Cohesion: 0.12
Nodes (24): adArchive(), checkAdLibrary(), handler(), resolveAdToken(), sb(), scoreBrand(), storePitch(), recordPipeline() (+16 more)

### Community 2 - "Community 2"
Cohesion: 0.19
Nodes (20): claude(), handler(), logRun(), sb(), arr(), autocomplete(), callClaude(), countWords() (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (2): barChart(), noBorder()

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (14): blockquote(), buildLightbox(), closeLightbox(), ensureEmbedScript(), esc(), init(), loadReels(), num() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.31
Nodes (15): handler(), urlEntry(), emailPitchToAastha(), generatePitch(), handleAdd(), handleHelp(), handleLeadDone(), handleLeads() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.34
Nodes (13): ensureHeroReels(), fetchCarouselChildren(), fetchDailySnapshot(), fetchDemographics(), fetchInsights(), fetchReachedDemographics(), fetchRecentMedia(), fetchStaleInsightPosts() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.38
Nodes (10): buildTargeting(), cleanupOldCampaigns(), fbDelete(), fbGet(), fbPost(), handler(), resolveReels(), sleep() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.44
Nodes (9): buildTargeting(), fbDelete(), fbGet(), fbPost(), handler(), resolveReel(), sleep(), uploadThumb() (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.47
Nodes (8): buildTargeting(), cleanupOldCampaigns(), fbDelete(), fbGet(), fbPost(), handler(), resolveCarousel(), uploadImage()

### Community 10 - "Community 10"
Cohesion: 0.32
Nodes (5): handler(), hash(), readFbCookies(), sendCapiEvent(), handler()

### Community 11 - "Community 11"
Cohesion: 0.46
Nodes (7): fbGet(), fbPost(), handler(), sbGet(), sbUpsert(), visitsFrom(), ymd()

### Community 12 - "Community 12"
Cohesion: 0.5
Nodes (6): cleanupOldCampaigns(), fbDelete(), fbGet(), fbPost(), findAudience(), handler()

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (7): currentActiveAds(), fbGet(), fbPost(), getImageUrl(), handler(), pickWinner(), sb()

### Community 14 - "Community 14"
Cohesion: 0.48
Nodes (5): fbGet(), handler(), sbGet(), sbUpsertDaily(), ymd()

### Community 15 - "Community 15"
Cohesion: 0.38
Nodes (3): handler(), remainingCount(), sb()

### Community 16 - "Community 16"
Cohesion: 0.67
Nodes (5): fetchDemo(), handler(), ig(), sb(), sleep()

### Community 17 - "Community 17"
Cohesion: 0.7
Nodes (4): applyEvent(), handler(), readRaw(), verify()

### Community 18 - "Community 18"
Cohesion: 0.67
Nodes (2): handler(), sb()

### Community 19 - "Community 19"
Cohesion: 0.67
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

## Knowledge Gaps
- **Thin community `Community 20`** (2 nodes): `handler()`, `analytics-auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `ig-profile.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `instagram.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `ig-stats.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `generate-pdf.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `esc()` connect `Community 0` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `handler()` connect `Community 0` to `Community 2`, `Community 5`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `sb()` connect `Community 2` to `Community 0`, `Community 5`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `handler()` (e.g. with `segmentMeta()` and `sb()`) actually correct?**
  _`handler()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `send()` (e.g. with `handler()` and `handler()`) actually correct?**
  _`send()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `handler()` (e.g. with `sb()` and `attachInstagramImages()`) actually correct?**
  _`handler()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `handler()` (e.g. with `getLiveProfile()` and `autosendEnabled()`) actually correct?**
  _`handler()` has 6 INFERRED edges - model-reasoned connections that need verification._