// Runs every model on both test sets and prints the numbers on Memopad's project page.
// Open index.html from a local web server; the models download from Hugging Face.

import { bm25 } from "../src/lib/search.js";
import * as papers from "./data/papers.js";
import * as personal from "./data/personal.js";
import { cosine, embedder, MODELS } from "./embed.js";
import { bootstrap, crossValidate, folds, groupSearches, keywordOnly, mean, ranking, run, shown, tune } from "./evaluate.js";

const SHIPPED = "Xenova/all-MiniLM-L6-v2";
const TRANSFORMERS = "3.5.1";

// Topics in neither test set, used to measure how close each note sits to everything.
const ANCHORS = ["weather forecast", "lighthouses", "piano lessons", "kites", "origami", "tea ceremonies",
  "mountain hiking", "jazz music", "glaciers", "clocks", "fashion trends", "chess openings", "volcanoes",
  "photography", "poetry", "board games", "architecture", "birds", "electric cars", "painting", "bridges", "snowboarding",
  "politics", "lanterns", "the human brain", "climate change", "furniture", "video games", "mythology"];

const out = document.querySelector("#out");
const log = (line = "") => { out.textContent += line + "\n"; };
const fixed = (x, n = 2) => x.toFixed(n);
const interval = ({ mean: m, low, high }, n = 3) => `${fixed(m, n)} [${fixed(low, n)}, ${fixed(high, n)}]`;
const short = (name) => name.split("/")[1];

// One row per search: its BM25 scores and cosine similarities against every note in its set.
// Notes are searched as their text plus the title of the page they were saved from.
async function prepare(embed, set, { q = "", d = "" }, { titles = true } = {}) {
  const items = set.notes.map((n) => (typeof n === "string" ? { text: n } : n));
  const docs = items.map((n) => (titles && n.title ? `${n.text}\n${n.title}` : n.text));
  const noteVectors = await embed(docs.map((t) => d + t));
  const started = performance.now();
  const searchVectors = await embed(set.queries.map(([t]) => q + t));
  const msPerSearch = (performance.now() - started) / set.queries.length;
  return {
    msPerSearch,
    noteVectors,
    rows: set.queries.map(([text, relevant], i) => ({
      text,
      items,
      relevant: new Set(relevant),
      keyword: bm25(text, docs),
      similarity: noteVectors.map((v) => cosine(searchVectors[i], v)),
    })),
  };
}

async function both(embed, prefixes, options) {
  const p = await prepare(embed, personal, prefixes, options);
  const r = await prepare(embed, papers, prefixes, options);
  const n = p.rows.length + r.rows.length;
  return { rows: [...p.rows, ...r.rows], sets: [p, r], msPerSearch: (p.msPerSearch * p.rows.length + r.msPerSearch * r.rows.length) / n };
}

const list = (row, floor, margin) =>
  shown(row.keyword, row.similarity, floor, margin).map((i) => `${row.relevant.has(i) ? "+" : "-"} ${row.items[i].text.slice(0, 40)}`).join("; ") || "(nothing)";

const started = performance.now();
out.textContent = "";
log(`Memopad search evaluation. Transformers.js ${TRANSFORMERS}, WebAssembly, one thread. ${new Date().toISOString().slice(0, 10)}.`);
log(navigator.userAgent);

// The split doesn't depend on the model, so describe it once.
const shape = (await both(async (texts) => texts.map(() => [1]), {})).rows;
const groups = groupSearches(shape);
const fold = folds(groups, 5, 1);
const noAnswer = shape.filter((r) => !r.relevant.size).length;
log(`\nTest set: ${personal.notes.length + papers.notes.length} notes (${personal.notes.length} personal, ${papers.notes.length} from AI papers), ${shape.length} searches, ${noAnswer} with no right answer.`);
log(`Grouped 5-fold cross-validation: ${new Set(groups).size} groups of searches (near-copies kept together), fold sizes ${[0, 1, 2, 3, 4].map((f) => fold.filter((x) => x === f).length).join(", ")}.`);
log("Intervals are 95% bootstrap intervals, resampling the groups of searches (1,000 resamples, seed 1).");

// Keyword search alone needs no model.
const keyword = keywordOnly(shape);
const keywordRun = run(shape, shape.map((_, i) => i), Infinity, Infinity);
log(`\nKeyword search only (what Memopad 2.0 ships): F1 ${interval(bootstrap(keyword, { groups }))}, precision ${fixed(keywordRun.precision)}, recall ${fixed(keywordRun.recall)}, false positives ${keywordRun.falsePositives}, no-answer searches left empty ${keywordRun.emptyWhenNoAnswer}`);

log("\nModel | MB | pooling | ms per search | AUC | MRR | R@5 | best fixed threshold: precision | tuned on all: floor, margin, false positives | cross-validated F1 [95%] | vs MiniLM [95%] | vs keyword only [95%] | groceries | no-answer left empty");
const results = {};
for (const [name, prefixes] of Object.entries(MODELS)) {
  const embed = await embedder(name);
  const { rows, msPerSearch } = await both(embed, prefixes);
  const all = rows.map((_, i) => i);
  const rank = ranking(rows);
  const bestFixed = tune(rows, all, [Infinity]);
  const tuned = tune(rows, all);
  const cv = crossValidate(rows);
  const groceries = rows.find((r) => r.text === "groceries");
  const found = shown(groceries.keyword, groceries.similarity, tuned.floor, tuned.margin).filter((i) => groceries.relevant.has(i)).length;
  results[name] = { rank, bestFixed, tuned, cv, found, msPerSearch, pooling: embed.pooling };
  const vsShipped = name === SHIPPED ? "—" : interval(bootstrap(cv.perSearch, { baseline: results[SHIPPED].cv.perSearch, groups }));
  log(`${short(name)} | ${prefixes.mb} | ${embed.pooling} | ${Math.round(msPerSearch)} | ${fixed(rank.auc, 3)} | ${fixed(rank.mrr, 3)} | ${fixed(rank.recallAt5, 3)} | ${fixed(bestFixed.precision, 3)} | ${tuned.floor}, ${tuned.margin}, ${tuned.falsePositives} | ${interval(bootstrap(cv.perSearch, { groups }))} | ${vsShipped} | ${interval(bootstrap(cv.perSearch, { baseline: keyword, groups }))} | ${found} of ${groceries.relevant.size} | ${tuned.emptyWhenNoAnswer}`);
}

// A deeper look at the model Memopad was built around.
const embed = await embedder(SHIPPED);
const { rows, sets } = await both(embed, MODELS[SHIPPED]);
const all = rows.map((_, i) => i);
const { floor, margin } = results[SHIPPED].tuned;

const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];
const relevantScores = [], unrelatedScores = [];
for (const r of rows) r.similarity.forEach((s, i) => (r.relevant.has(i) ? relevantScores : unrelatedScores).push(s));
log(`\n${short(SHIPPED)}: cosine similarity, median and 90th percentile`);
log(`  right notes: ${fixed(quantile(relevantScores, 0.5))}, ${fixed(quantile(relevantScores, 0.9))}`);
log(`  unrelated notes: ${fixed(quantile(unrelatedScores, 0.5))}, ${fixed(quantile(unrelatedScores, 0.9))}`);
log(`  unrelated note-and-search pairs above 0.2: ${unrelatedScores.filter((s) => s > 0.2).length} of ${unrelatedScores.length}`);

log(`\n${short(SHIPPED)}: false positives across all searches`);
log(`  every note above 0.2: ${run(rows, all, 0.2, Infinity).falsePositives}`);
log(`  best fixed threshold (${results[SHIPPED].bestFixed.floor}): ${results[SHIPPED].bestFixed.falsePositives}`);
log(`  hybrid rules (floor ${floor}, margin ${margin}): ${results[SHIPPED].tuned.falsePositives}`);
log(`  keyword search only: ${keywordRun.falsePositives}`);

log(`\n${short(SHIPPED)}: searches with the most wrong results under the hybrid rules`);
const wrong = rows
  .map((r) => ({ r, bad: shown(r.keyword, r.similarity, floor, margin).filter((i) => !r.relevant.has(i)) }))
  .filter(({ bad }) => bad.length)
  .sort((a, b) => b.bad.length - a.bad.length);
for (const { r, bad } of wrong.slice(0, 8)) log(`  ${r.text}: ${bad.map((i) => r.items[i].text.slice(0, 30)).join("; ")}`);

log("\nReal searches: before (every note above 0.2, no page titles), after (hybrid rules, page titles searched), keyword only");
const before = (await both(embed, MODELS[SHIPPED], { titles: false })).rows;
for (const text of ["groceries", "AI alignment", "red teaming", "quantum physics"]) {
  const row = rows.find((r) => r.text === text);
  log(`  ${text}`);
  log(`    before:  ${list(before.find((r) => r.text === text), 0.2, Infinity)}`);
  log(`    after:   ${list(row, floor, margin)}`);
  log(`    keyword: ${list(row, Infinity, Infinity)}`);
}

log("\nA stricter floor, on all searches");
for (const f of [floor, 0.34]) {
  const m = run(rows, all, f, margin);
  log(`  floor ${f}: F1 ${fixed(m.f1, 3)}, precision ${fixed(m.precision)}, recall ${fixed(m.recall)}, false positives ${m.falsePositives}`);
}

log("\nHubness correction: subtract each note's mean top-10 similarity to the anchor topics, times λ");
const anchors = await embed(ANCHORS.map((t) => (MODELS[SHIPPED].q ?? "") + t));
const hubness = sets.map(({ noteVectors }) =>
  noteVectors.map((v) => anchors.map((a) => cosine(a, v)).sort((x, y) => y - x).slice(0, 10).reduce((s, x) => s + x, 0) / 10));
const uncorrected = crossValidate(rows).perSearch;
for (const lambda of [0, 0.5, 0.75, 1]) {
  const corrected = rows.map((r, i) => {
    const h = hubness[i < sets[0].rows.length ? 0 : 1];
    return { ...r, similarity: r.similarity.map((s, j) => s - lambda * h[j]) };
  });
  const cv = crossValidate(corrected);
  const gain = lambda ? `, change ${interval(bootstrap(cv.perSearch, { baseline: uncorrected, groups }))}` : "";
  log(`  λ ${lambda}: cross-validated F1 ${fixed(cv.f1, 3)}${gain}`);
}

const gte = await embedder("Xenova/gte-small");
const quantum = (await both(gte, MODELS["Xenova/gte-small"])).rows.find((r) => r.text === "quantum physics");
log(`\ngte-small: top similarity for "quantum physics" (no right answer): ${fixed(Math.max(...quantum.similarity))}`);

log(`\nDone in ${Math.round((performance.now() - started) / 1000)} s.`);
window.results = results;

// Save the output exactly as printed, for research/results.txt.
const save = document.querySelector("#save");
save.hidden = false;
save.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([out.textContent], { type: "text/plain" }));
  link.download = "results.txt";
  link.click();
});
