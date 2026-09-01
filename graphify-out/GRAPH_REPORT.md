# Graph Report - .  (2026-09-01)

## Corpus Check
- 50 files · ~867,057 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 317 nodes · 625 edges · 25 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 138 edges (avg confidence: 0.8)
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
1. `text()` - 28 edges
2. `handler()` - 18 edges
3. `sb()` - 17 edges
4. `handler()` - 14 edges
5. `handler()` - 14 edges
6. `send()` - 13 edges
7. `handler()` - 12 edges
8. `renderArticle()` - 11 edges
9. `esc()` - 11 edges
10. `handler()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `urlEntry()` --calls--> `esc()`  [INFERRED]
  api/sitemap.js → api/_pitch.js
- `text()` --calls--> `callClaude()`  [INFERRED]
  api/_blog-qa.js → api/cron/blog-audit.js
- `handler()` --calls--> `send()`  [INFERRED]
  api/sitemap.js → api/telegram.js
- `handler()` --calls--> `text()`  [INFERRED]
  api/invoice-save.js → api/_blog-qa.js
- `send()` --calls--> `handler()`  [INFERRED]
  api/telegram.js → api/blog-index.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (35): checkText(), mechanicalProblems(), unsupportedNumbers(), verifyClaims(), adArchive(), checkAdLibrary(), generateCheckedPitch(), handler() (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.12
Nodes (30): currentActiveAds(), fbGet(), fbPost(), handler(), pickWinner(), sb(), buildTargeting(), handler() (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.16
Nodes (34): attachInstagramImages(), ctaBlock(), dedupePostImages(), esc(), handler(), hashStr(), filterBar(), handler() (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (29): arr(), editorGate(), extractText(), factGate(), num(), reviseDraft(), arr(), autocomplete() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (22): ruleGate(), text(), wordCount(), fbGet(), fbPost(), handler(), sbGet(), sbUpsert() (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (2): barChart(), noBorder()

### Community 6 - "Community 6"
Cohesion: 0.25
Nodes (14): blockquote(), buildLightbox(), closeLightbox(), ensureEmbedScript(), esc(), init(), loadReels(), num() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.32
Nodes (14): ensureHeroReels(), fetchCarouselChildren(), fetchDailySnapshot(), fetchDemographics(), fetchFollowsUnfollows(), fetchInsights(), fetchReachedDemographics(), fetchRecentMedia() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (10): alert(), callClaude(), handler(), handler(), claude(), handler(), logRun(), sb() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.43
Nodes (13): emailPitchToAastha(), generatePitch(), handleAdd(), handleHelp(), handleLeadDone(), handleLeads(), handleList(), handlePitch() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.39
Nodes (7): handler(), mirror(), pendingCount(), pendingFilter(), publicUrl(), sb(), storageExists()

### Community 11 - "Community 11"
Cohesion: 0.32
Nodes (5): handler(), hash(), readFbCookies(), sendCapiEvent(), handler()

### Community 12 - "Community 12"
Cohesion: 0.48
Nodes (5): fbGet(), handler(), sbGet(), sbUpsertDaily(), ymd()

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (5): fetchDemo(), handler(), ig(), sb(), sleep()

### Community 14 - "Community 14"
Cohesion: 0.7
Nodes (4): applyEvent(), handler(), readRaw(), verify()

### Community 15 - "Community 15"
Cohesion: 0.5
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 0.5
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 0.67
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
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

## Knowledge Gaps
- **Thin community `Community 18`** (2 nodes): `handler()`, `analytics-auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `invoice-auth.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `invoice-list.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `ig-profile.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `instagram.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `invoice-next.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `generate-pdf.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `text()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 13`, `Community 14`?**
  _High betweenness centrality (0.363) - this node is a cross-community bridge._
- **Why does `sb()` connect `Community 8` to `Community 0`, `Community 2`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.196) - this node is a cross-community bridge._
- **Why does `sb()` connect `Community 1` to `Community 4`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Are the 25 inferred relationships involving `text()` (e.g. with `handler()` and `sb()`) actually correct?**
  _`text()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `handler()` (e.g. with `segmentMeta()` and `sb()`) actually correct?**
  _`handler()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `sb()` (e.g. with `handler()` and `handler()`) actually correct?**
  _`sb()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `handler()` (e.g. with `sb()` and `attachInstagramImages()`) actually correct?**
  _`handler()` has 11 INFERRED edges - model-reasoned connections that need verification._