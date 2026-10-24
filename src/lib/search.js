// Keyword search: BM25 with prefix matching, over a note's text and the title of
// the page it was saved from. Pure functions, so they run in Node tests too.

export function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 || /\d/.test(t));
}

export function bm25(query, docs, { k1 = 1.2, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(query))];
  const toks = docs.map(tokenize);
  const avgLen = toks.reduce((s, t) => s + t.length, 0) / Math.max(toks.length, 1) || 1;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  return toks.map((t) => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      // Prefix match so "meet" finds "meeting" while typing.
      let f = tf.get(w) ?? 0;
      let n = df.get(w) ?? 0;
      if (!f) {
        for (const [word, count] of tf) if (word.startsWith(w)) f += count;
        if (f) for (const [word, d] of df) if (word.startsWith(w)) n = Math.max(n, d);
      }
      if (!f) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avgLen));
    }
    return score;
  });
}

// What a note is about: its text, plus the title of the page it was saved from.
export const noteText = (note) => (note.page?.title ? `${note.text}\n${note.page.title}` : note.text);

/** Notes that contain the query's words (or words starting with them), best first. */
export function search(query, notes) {
  if (!query.trim()) return notes;
  const scores = bm25(query, notes.map(noteText));
  return notes
    .map((note, i) => [scores[i], note])
    .filter(([score]) => score > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, note]) => note);
}
