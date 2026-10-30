// Scoring for retrieval with abstention: rank the right notes first, and return nothing
// when nothing matches. Pure functions over precomputed scores, so Node can test them.

// Margins the rules are tuned over. An infinite margin means a fixed threshold.
export const MARGINS = [...Array.from({ length: 30 }, (_, i) => (i + 1) / 100), Infinity];

// The hybrid rule. Keyword (BM25) matches come first, best first. A semantic match follows
// only if its cosine similarity clears the floor and is within `margin` of the top score.
// An infinite floor turns semantic matching off: keyword search only.
// Returns note indices in the order Memopad would show them.
export function shown(keyword, similarity, floor, margin) {
  const top = Math.max(...similarity);
  const byKeyword = keyword
    .map((score, i) => [score, i])
    .filter(([score]) => score > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  const byMeaning = similarity
    .map((score, i) => [score, i])
    .filter(([score, i]) => keyword[i] === 0 && score >= floor && score >= top - margin)
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  return [...byKeyword, ...byMeaning];
}

// F1 for a search with right answers. A search with none scores 1 for showing nothing, else 0.
export function scoreSearch(list, relevant) {
  if (!relevant.size) return { score: list.length ? 0 : 1, tp: 0, fp: list.length, fn: 0 };
  const tp = list.filter((i) => relevant.has(i)).length;
  const fp = list.length - tp;
  const fn = relevant.size - tp;
  return { score: tp ? (2 * tp) / (2 * tp + fp + fn) : 0, tp, fp, fn };
}

// Mean per-search F1 over `indices`, plus micro precision, recall and the false positives.
export function run(rows, indices, floor, margin) {
  let score = 0, tp = 0, fp = 0, fn = 0, empty = 0, noAnswer = 0;
  for (const i of indices) {
    const { keyword, similarity, relevant } = rows[i];
    const r = scoreSearch(shown(keyword, similarity, floor, margin), relevant);
    score += r.score; tp += r.tp; fp += r.fp; fn += r.fn;
    if (!relevant.size) { noAnswer++; empty += r.score; }
  }
  return {
    f1: score / indices.length,
    precision: tp / (tp + fp || 1),
    recall: tp / (tp + fn || 1),
    falsePositives: fp,
    emptyWhenNoAnswer: `${empty} of ${noAnswer}`,
  };
}

// The floor and margin with the best mean F1 on `indices`.
export function tune(rows, indices, margins = MARGINS) {
  let best = null;
  for (let step = 0; step <= 95; step++) {
    const floor = step / 100;
    for (const margin of margins) {
      const m = run(rows, indices, floor, margin);
      if (!best || m.f1 > best.f1) best = { ...m, floor, margin };
    }
  }
  return best;
}

// Searches that share most of their right answers ("groceries" and "shopping list") are
// near-copies. Put each such cluster in one group, so cross-validation never tunes on one
// copy and scores the other. Searches with no right answer are their own group.
export function groupSearches(rows, minOverlap = 0.5) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < rows.length; a++)
    for (let b = a + 1; b < rows.length; b++) {
      const ra = rows[a], rb = rows[b];
      if (ra.items !== rb.items || !ra.relevant.size || !rb.relevant.size) continue;
      const shared = [...ra.relevant].filter((i) => rb.relevant.has(i)).length;
      const union = new Set([...ra.relevant, ...rb.relevant]).size;
      if (shared / union >= minOverlap) parent[find(a)] = find(b);
    }
  return rows.map((_, i) => find(i));
}

// A small seeded random number generator (mulberry32), so every run splits and resamples
// the same way.
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Assigns each group to one of k folds: groups shuffled with a fixed seed, then dealt out.
export function folds(groups, k = 5, seed = 1) {
  const ids = [...new Set(groups)];
  const rand = random(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const foldOf = new Map(ids.map((id, i) => [id, i % k]));
  return groups.map((g) => foldOf.get(g));
}

// Grouped k-fold cross-validation: tune the floor and margin on k - 1 folds, score each
// search in the held-out fold. Returns every search's held-out score and their mean.
export function crossValidate(rows, { k = 5, seed = 1 } = {}) {
  const fold = folds(groupSearches(rows), k, seed);
  const perSearch = new Array(rows.length);
  for (let f = 0; f < k; f++) {
    const train = rows.map((_, i) => i).filter((i) => fold[i] !== f);
    const test = rows.map((_, i) => i).filter((i) => fold[i] === f);
    if (!test.length) continue;
    const { floor, margin } = tune(rows, train);
    for (const i of test) perSearch[i] = scoreSearch(shown(rows[i].keyword, rows[i].similarity, floor, margin), rows[i].relevant).score;
  }
  return { f1: mean(perSearch), perSearch };
}

// Per-search scores for keyword search alone, the rule Memopad 2.0 shipped with.
export function keywordOnly(rows) {
  return rows.map((r) => scoreSearch(shown(r.keyword, r.similarity, Infinity, Infinity), r.relevant).score);
}

// 95% bootstrap interval for the mean of per-search scores. With `groups`, whole groups of
// near-copy searches are resampled together, since they aren't independent.
// With `baseline`, the interval is for the paired difference (scores minus baseline).
export function bootstrap(scores, { baseline = null, groups = null, n = 1000, seed = 1 } = {}) {
  const values = baseline ? scores.map((s, i) => s - baseline[i]) : scores;
  const clusters = [...Map.groupBy(values.map((_, i) => i), (i) => (groups ? groups[i] : i)).values()];
  const rand = random(seed);
  const means = [];
  for (let b = 0; b < n; b++) {
    let sum = 0, count = 0;
    for (let c = 0; c < clusters.length; c++)
      for (const i of clusters[Math.floor(rand() * clusters.length)]) { sum += values[i]; count++; }
    means.push(sum / count);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(values), low: means[Math.floor(0.025 * n)], high: means[Math.ceil(0.975 * n) - 1] };
}

// ROC-AUC, MRR and recall@5 of the raw similarity ranking, before any cut-off,
// averaged over the searches that have right answers.
export function ranking(rows) {
  const aucs = [], mrrs = [], recalls = [];
  for (const { similarity, relevant } of rows) {
    if (!relevant.size) continue;
    const pos = similarity.filter((_, i) => relevant.has(i));
    const neg = similarity.filter((_, i) => !relevant.has(i));
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    aucs.push(wins / (pos.length * neg.length));
    const order = similarity.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    mrrs.push(1 / (order.findIndex((i) => relevant.has(i)) + 1));
    recalls.push(order.slice(0, 5).filter((i) => relevant.has(i)).length / Math.min(5, relevant.size));
  }
  return { auc: mean(aucs), mrr: mean(mrrs), recallAt5: mean(recalls) };
}

export function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
