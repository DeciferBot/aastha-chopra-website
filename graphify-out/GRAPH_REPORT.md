# Graph Report - .  (2026-06-14)

## Corpus Check
- 22 files · ~7,962,367 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 116 nodes · 179 edges · 18 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `send()` - 10 edges
2. `handler()` - 10 edges
3. `sb()` - 8 edges
4. `handler()` - 7 edges
5. `handler()` - 7 edges
6. `ig()` - 7 edges
7. `handlePitch()` - 6 edges
8. `handler()` - 6 edges
9. `handler()` - 6 edges
10. `getLiveProfile()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `getLiveProfile()` --calls--> `handler()`  [INFERRED]
  api/_profile.js → api/cron/daily-agent.js
- `handler()` --calls--> `sendCapiEvent()`  [INFERRED]
  api/capi-event.js → api/_capi.js
- `handler()` --calls--> `sendCapiEvent()`  [INFERRED]
  api/subscribe.js → api/_capi.js
- `handler()` --calls--> `generatePitch()`  [INFERRED]
  api/pitch-now.js → api/_pitch.js
- `handler()` --calls--> `sendPitchEmail()`  [INFERRED]
  api/pitch-now.js → api/_pitch.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (2): barChart(), noBorder()

### Community 1 - "Community 1"
Cohesion: 0.43
Nodes (13): emailPitchToAastha(), generatePitch(), handleAdd(), handleHelp(), handleLeadDone(), handleLeads(), handleList(), handlePitch() (+5 more)

### Community 2 - "Community 2"
Cohesion: 0.25
Nodes (7): recordPipeline(), enc(), handler(), sb(), getLiveProfile(), latestGeneration(), sbGet()

### Community 3 - "Community 3"
Cohesion: 0.42
Nodes (10): fetchAllMedia(), fetchCarouselChildren(), fetchDailySnapshot(), fetchDemographics(), fetchInsights(), fetchReachedDemographics(), handler(), ig() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.39
Nodes (8): autosendEnabled(), buildFactSheet(), esc(), generatePitch(), renderBrandEmailHtml(), renderPitchEmailHtml(), sendBrandPitch(), sendPitchEmail()

### Community 5 - "Community 5"
Cohesion: 0.32
Nodes (5): handler(), hash(), readFbCookies(), sendCapiEvent(), handler()

### Community 6 - "Community 6"
Cohesion: 0.5
Nodes (7): adArchive(), checkAdLibrary(), handler(), resolveAdToken(), sb(), scoreBrand(), storePitch()

### Community 7 - "Community 7"
Cohesion: 0.5
Nodes (7): currentActiveAds(), fbGet(), fbPost(), getImageUrl(), handler(), pickWinner(), sb()

### Community 8 - "Community 8"
Cohesion: 0.67
Nodes (5): fetchDemo(), handler(), ig(), sb(), sleep()

### Community 9 - "Community 9"
Cohesion: 0.8
Nodes (4): claude(), handler(), logRun(), sb()

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (2): handler(), sb()

### Community 11 - "Community 11"
Cohesion: 0.67
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 12`** (2 nodes): `handler()`, `analytics-auth.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (2 nodes): `ig-profile.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (2 nodes): `reels.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (2 nodes): `instagram.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (2 nodes): `ig-stats.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (1 nodes): `generate-pdf.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handler()` connect `Community 6` to `Community 2`, `Community 4`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `handler()` connect `Community 2` to `Community 4`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `getLiveProfile()` connect `Community 2` to `Community 6`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `handler()` (e.g. with `getLiveProfile()` and `generatePitch()`) actually correct?**
  _`handler()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `handler()` (e.g. with `getLiveProfile()` and `autosendEnabled()`) actually correct?**
  _`handler()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._