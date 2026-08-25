# The algorithm

How Loop decides what to show, and why it decides that way.

Everything here is implemented in
[`backend/src/services/recommendations.js`](../backend/src/services/recommendations.js)
and [`backend/src/services/trending.js`](../backend/src/services/trending.js).
Every number lives in one `TUNING` object so behaviour can be changed without
reading code.

---

## The problem with the obvious approach

The simplest recommender is "show what has the most views". It fails badly:

```
  popular video  ->  shown more  ->  more views  ->  shown more  ->  ...
```

Nothing new ever escapes zero, because nothing new has views yet. The feed
converges on a handful of accounts, and a platform where only established
creators can be seen has no reason for anyone new to join.

The second-simplest recommender is "maximize watch time". That one fails
differently: an optimizer that only counts attention learns that outrage,
shock and cliffhangers hold attention, and starts promoting them. Nobody
designs that outcome — it is what pure engagement optimization *converges* to.

Loop is built to avoid both.

---

## The pipeline

```
  Candidate generation  ->  Filtering  ->  Ranking  ->  Diversity  ->  Safety  ->  Feed
```

### 1. Candidate generation

Six independent sources, so no single bias dominates:

| Source | What it contributes |
|---|---|
| `following` | creators the viewer explicitly chose |
| `interest` | topics they picked at signup or that we learned |
| `trending` | what is genuinely growing right now |
| `fresh` | recent uploads regardless of performance |
| **`exploration`** | **videos almost nobody has been shown yet** |
| `similar` | creators co-watched with ones they already like |

`exploration` is the one that matters most for fairness. It queries videos
ordered by **fewest impressions first** — the door through which a first upload
from an account with zero followers reaches real people.

### 2. Filtering — a hard gate

Removed before ranking, so nothing can score its way back in:

- blocked creators
- the viewer's own videos
- videos removed by moderation
- videos blocked or restricted on copyright grounds
- anything already shown in the last 72 hours
- anything already watched
- anything with no playable file

### 3. Ranking

A weighted sum of nine components, each roughly `0..1`:

| Component | Weight | What it measures |
|---|---:|---|
| `quality` | **3.0** | did people who saw it actually watch it through? |
| `interestMatch` | 2.6 | does the topic match this viewer? |
| `following` | 2.4 | do they follow this creator? |
| `creatorAffinity` | 2.0 | do they engage with this creator specifically? |
| **`fairness`** | **1.8** | small-creator and under-shown boost |
| `engagement` | 1.6 | likes/comments/shares/saves, **as rates** |
| `freshness` | 1.4 | exponential decay, 48-hour half-life |
| `negative` | **−3.0** | fast skips and dislikes |
| `repetition` | −2.2 | too much of one creator or topic lately |

Three of these deserve explaining.

#### `quality` — a rate, not a total

```js
completion * 0.8 + min(replayRate, 0.5) * 0.4
```

A video with 40 views where 90% watch to the end scores far above one with
40,000 views where 5% do. **This is the single most important fairness
decision in the system**: the biggest weight in the whole model is on a number
a creator with no audience can win on from their first upload.

A video with fewer than 3 watch sessions returns a neutral `0.5` rather than
`0`. An unproven video must not be punished for being unproven, or nothing new
would ever rise.

#### `fairness` — an explicit counterweight

```js
smallChannelBoost = 1 / (1 + log10(1 + followers))   // 0 followers -> 1.0, 100k -> ~0.15
underShown       = 1 - impressions / 500             // until it has had a fair trial
```

Both are bounded and both decay smoothly, so there is no threshold to farm.
Big channels still win when their content genuinely performs — they just do not
win *automatically*.

#### `negative` — why this is not an engagement maximizer

```js
skipRate * 0.7 + dislikeRate * 0.6      // weighted -3.0
```

In a scrolling feed the strongest honest signal is how fast someone swipes
away. Weighting that heavily and negatively is what stops the feed drifting
toward content that provokes reactions but that people bounce off.

A small random term (`+0..0.35`) is added to every score. Without it, ranking
is deterministic and everyone with similar taste sees an identical ordering
forever — which quietly recreates winner-take-all.

### 4. Diversity

- at most **2 videos per creator** per page
- at most **4 per category** per page
- at least **30% of every page** must come from the exploration pool

If the pool is too thin to fill a page within the caps, Loop returns a **short
feed rather than backfilling past them**. On a young platform the candidate pool
is often dominated by one prolific account, and filling the page from it would
hand that account the entire feed — exactly what the caps exist to prevent.

### 5. Safety — last, deliberately

Flagged and removed content is filtered **after** ranking. If safety were a
scoring component, a sufficiently engaging piece of harmful content could
out-score its own safety penalty. As a separate final pass, it cannot.

---

## Does it actually work?

From the seeded development data (`npm run seed`), the feed for a signed-out
viewer with no history:

```
 #  title                              creator      followers    views  score  quality  fair   neg
 1. What a black hole actually does    @astro             783     3400   6.94     0.76  0.63  0.10
 2. 60 second garlic noodles           @maya            42003    24000   6.29     0.77  0.59  0.09
 3. I built my first app today         @devkid              5       60   6.13     0.74  0.78  0.10
 4. Roblox dancing                     @roblox850          38      445   5.80     0.56  0.69  0.13
 ...
 9. Another daily upload               @bigstudio      512003   210000   3.87     0.31  0.57  0.24
10. YOU WONT BELIEVE THIS              @bigstudio      512003   890000   1.89     0.06  0.53  0.53
```

- **@devkid — 5 followers, 60 views — ranks 3rd**, above a 24,000-view video,
  because people finish their videos.
- **The 890,000-view clickbait ranks last**, because `quality = 0.06` and
  `negative = 0.53`.
- Creators with under 100 followers take **4 of 10 slots**.

These properties are asserted in the test suite (`Recommendation fairness`), so
a future tuning change cannot quietly undo them.

---

## Cold start

**No videos on the platform at all** → the API returns
`mode: 'empty_platform'` and the honest empty state ("No videos yet. Be one of
the first creators."). Nothing is hard-coded; the UI renders whatever
`platformState()` reports.

The platform describes itself in stages, and moves between them automatically:

| Stage | Condition |
|---|---|
| `empty` | 0 public videos |
| `seedling` | 1–24 |
| `growing` | 25–249 |
| `established` | 250+ |

**No history for this viewer** → onboarding asks which topics they like. Those
choices are written to `user_interests` with `source = 'onboarding'` and act as
the starting signal until real behaviour accumulates.

---

## Learning, and forgetting

After every watch:

| Behaviour | Interest weight |
|---|---:|
| finished (≥80%) | +0.50 |
| watched (≥40%) | +0.25 |
| opened | +0.05 |
| **skipped fast** | **−0.25** |
| liked | +0.40 |

Creator affinity moves the same way at 0.8×.

Weights **decay by 2% per hour** (`decayInterests`, run by the worker). Without
decay a profile becomes a permanent record of everything you ever clicked, and
the feed slowly turns into a museum of your past self. Decay is what lets taste
change.

---

## Trending is a separate algorithm

Trending is **not** "highest lifetime views" — that list barely changes and is
useless for discovery. It measures **velocity**:

```js
growth    = (recentViews + 1) / (priorViews + 1)     // 24h window vs the 24h before
breadth   = uniqueViewers / recentViews              // many people, or a few on repeat?
score     = log2(1+growth)*3.0 + log10(1+recentViews)*1.5
          + breadth*2.0 + completion*2.5 + engagementRate*2.0
score    *= (breadth < 0.3 && recentViews > 50) ? 0.5 : 1   // manipulation penalty
```

A video going from 5 views to 400 outranks one sitting steadily at a million.
Concentrated traffic — many views from few distinct viewers — is penalized
rather than blocked, because legitimate niche content can look similar and a
human should make the removal call.

---

## Tuning it

Everything is in `TUNING` at the top of `recommendations.js`:

```js
explorationShare: 0.30,          // raise to favour new creators harder
maxPerCreator: 2,                // per page
fairChanceImpressions: 500,      // how long a video counts as "under-shown"
freshnessHalfLifeHours: 48,
weights: { quality: 3.0, fairness: 1.8, negative: -3.0, ... },
```

If you change these, **run the tests**. The fairness suite encodes the
properties this design is meant to guarantee, and it should fail if a change
breaks them.
