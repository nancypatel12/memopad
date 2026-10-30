// Tests for the search evaluation's scoring, on tiny hand-made examples.

import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrap, crossValidate, folds, groupSearches, keywordOnly, ranking, run, scoreSearch, shown } from "./evaluate.js";

const row = (keyword, similarity, relevant, items = "notes") => ({ keyword, similarity, relevant: new Set(relevant), items });

test("keyword matches come first, then semantic matches above the floor and within the margin", () => {
  const keyword = [0, 2, 0, 0];
  const similarity = [0.9, 0.1, 0.5, 0.85];
  assert.deepEqual(shown(keyword, similarity, 0.3, 0.1), [1, 0, 3]);
  assert.deepEqual(shown(keyword, similarity, 0.3, Infinity), [1, 0, 3, 2]);
});

test("an infinite floor means keyword search only", () => {
  assert.deepEqual(shown([0, 1, 0], [0.9, 0.2, 0.8], Infinity, Infinity), [1]);
});

test("a search with no right answer scores 1 only for showing nothing", () => {
  assert.equal(scoreSearch([], new Set()).score, 1);
  assert.equal(scoreSearch([3], new Set()).score, 0);
});

test("a search with right answers scores F1", () => {
  // 1 right of 2 shown, 1 of 2 right notes found: precision 0.5, recall 0.5.
  assert.equal(scoreSearch([0, 1], new Set([0, 2])).score, 0.5);
});

test("run averages F1 over searches and counts false positives", () => {
  const rows = [row([0, 0], [0.9, 0.1], [0]), row([0, 0], [0.1, 0.1], [])];
  const m = run(rows, [0, 1], 0.5, Infinity);
  assert.equal(m.f1, 1);
  assert.equal(m.falsePositives, 0);
  assert.equal(m.emptyWhenNoAnswer, "1 of 1");
});

test("near-copy searches share a group; other sets and no-answer searches don't", () => {
  const rows = [
    row([], [], [1, 2, 3]),
    row([], [], [1, 2, 3]),
    row([], [], [7, 8]),
    row([], [], []),
    row([], [], [1, 2, 3], "other notes"),
  ];
  const g = groupSearches(rows);
  assert.equal(g[0], g[1]);
  assert.notEqual(g[0], g[2]);
  assert.notEqual(g[3], g[0]);
  assert.notEqual(g[4], g[0]);
});

test("folds keep each group together and repeat with the same seed", () => {
  const groups = [0, 0, 1, 2, 2, 3, 4, 5, 6, 7];
  const a = folds(groups, 3, 7);
  assert.equal(a[0], a[1]);
  assert.equal(a[3], a[4]);
  assert.deepEqual(a, folds(groups, 3, 7));
});

test("cross-validation scores every search once, between 0 and 1", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row([0, 0, 0], [0.9 - i / 100, 0.2, 0.1], i % 4 === 0 ? [] : [0]));
  const { f1, perSearch } = crossValidate(rows, { k: 3 });
  assert.equal(perSearch.length, rows.length);
  assert.ok(perSearch.every((s) => s >= 0 && s <= 1));
  assert.ok(f1 >= 0 && f1 <= 1);
});

test("keyword only ignores similarity", () => {
  assert.deepEqual(keywordOnly([row([0, 1], [0.99, 0], [1]), row([0, 0], [0.99, 0.99], [])]), [1, 1]);
});

test("bootstrap of identical scores has no spread, and a paired difference with itself is zero", () => {
  const scores = [0.5, 0.5, 0.5, 0.5];
  assert.deepEqual(bootstrap(scores), { mean: 0.5, low: 0.5, high: 0.5 });
  assert.deepEqual(bootstrap([0.2, 0.9], { baseline: [0.2, 0.9] }), { mean: 0, low: 0, high: 0 });
});

test("a perfect ranking has ROC-AUC and MRR of 1", () => {
  const r = ranking([row([], [0.9, 0.8, 0.1], [0, 1]), row([], [0.1], [])]);
  assert.equal(r.auc, 1);
  assert.equal(r.mrr, 1);
  assert.equal(r.recallAt5, 1);
});

test("a grouped bootstrap resamples near-copy searches together", () => {
  // Two groups with constant scores inside each: every resample's mean is 0, 0.5 or 1.
  const { low, high } = bootstrap([0, 0, 1, 1], { groups: [0, 0, 1, 1], n: 200 });
  assert.ok([0, 0.5, 1].includes(low) && [0, 0.5, 1].includes(high));
});
