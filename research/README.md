# Search evaluation

Can a small embedding model, running in the browser, search notes by meaning without showing wrong results? This kit measures it, and it's why Memopad 2.0 ships keyword search only.

## Run it

The models run in the browser, so serve the repo and open the page:

```bash
python3 -m http.server 8000    # from the repo root
```

Then open http://localhost:8000/research/. The first run downloads about 250 MB of models from Hugging Face. A full run takes under two minutes on a MacBook M3 Pro. **Save results.txt** downloads the output; mine is in [`results.txt`](results.txt).

The scoring code has unit tests, which run with the extension's:

```bash
npm test
```

## What it measures

| | |
|---|---|
| Test set | 93 notes (57 personal, 36 saved from AI papers) and 51 searches, 8 with no right answer, in `data/` |
| Models | Nine small sentence-embedding models, 8-bit quantized ONNX, run with Transformers.js 3.5.1 on WebAssembly, each with the pooling and prefixes its authors recommend |
| Search | BM25 keyword matches first, then semantic matches by cosine similarity, above a floor and within a margin of the top match |
| Baseline | Keyword search alone, what Memopad ships |
| Main score | Cross-validated F1: the floor and margin are tuned on four folds and scored on the fifth. A search with no right answer scores 1 for returning nothing, 0 otherwise |
| Split | Grouped 5-fold cross-validation with a fixed seed. Searches that share most of their right answers, like *groceries* and *shopping list*, stay in the same fold, so the rules are never tuned on a near-copy of a search they're scored on |
| Uncertainty | 95% bootstrap intervals that resample whole groups of near-copy searches (1,000 resamples, fixed seed), and paired intervals for each model's difference from all-MiniLM-L6-v2 and from keyword search |
| Also | ROC-AUC, MRR and recall@5 of the raw ranking, precision at the best fixed threshold, time per search, a stricter floor, and a hubness correction |

## Files

| File | What's there |
|---|---|
| `index.html` | The page that runs everything |
| `run.js` | Runs each model on both test sets and prints the results |
| `evaluate.js` | Scoring: the hybrid rule, F1 with abstention, grouped cross-validation, bootstrap intervals, ranking metrics |
| `evaluate.test.js` | Unit tests for `evaluate.js` |
| `embed.js` | Loading the models and turning text into vectors |
| `data/` | The notes, the searches, and the right answers for each |

## Limits

- The test set is small, and I wrote and labeled it myself. One labeler, no agreement check.
- Only 8 searches have no right answer, so abstention is measured coarsely.
- Model weights load from the latest revision on Hugging Face, and results shift slightly between Transformers.js versions.
