// Small sentence-embedding models, run in the browser with Transformers.js, as Memopad
// would have run them. Vectors come back unit length, so cosine similarity is a dot product.

import { AutoModel, AutoTokenizer, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";

env.allowLocalModels = false;
// One thread, as inside an extension popup.
env.backends.onnx.wasm.numThreads = 1;

const RETRIEVAL = "Represent this sentence for searching relevant passages: ";

// Each model's pooling, its size, and the prefixes its authors recommend for searches (q)
// and notes (d). `external` marks weights stored in a separate .onnx_data file.
// The first is the model Memopad 2.0 was built around.
export const MODELS = {
  "Xenova/all-MiniLM-L6-v2": { pool: "mean", mb: 23 },
  "Xenova/paraphrase-MiniLM-L6-v2": { pool: "mean", mb: 23 },
  "Xenova/all-MiniLM-L12-v2": { pool: "mean", mb: 34 },
  "Xenova/bge-small-en-v1.5": { pool: "cls", q: RETRIEVAL, mb: 33 },
  "Xenova/gte-small": { pool: "mean", mb: 34 },
  "Xenova/e5-small-v2": { pool: "mean", q: "query: ", d: "passage: ", mb: 34 },
  "Snowflake/snowflake-arctic-embed-xs": { pool: "cls", q: RETRIEVAL, mb: 23 },
  "MongoDB/mdbr-leaf-ir": { pool: "mean", q: RETRIEVAL, mb: 23, external: true },
  "onnx-community/granite-embedding-30m-english-ONNX": { pool: "cls", mb: 30, external: true },
};

// Returns a function that embeds a list of texts with the model's 8-bit quantized weights.
export async function embedder(name) {
  const { pool, external = false } = MODELS[name];
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(name),
    AutoModel.from_pretrained(name, { dtype: "q8", device: "wasm", use_external_data_format: external }),
  ]);
  const embed = async (texts) => {
    const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 256 });
    const output = await model(inputs);
    const unit = (vector) => {
      const norm = Math.hypot(...vector) || 1;
      return vector.map((x) => x / norm);
    };
    // Some models export their own pooled embedding, including any projection layer after
    // pooling. Use it when it's there, so each model is scored the way its authors run it.
    embed.pooling = output.sentence_embedding ? "model's own" : pool;
    if (output.sentence_embedding) {
      const [batch, dims] = output.sentence_embedding.dims;
      const data = output.sentence_embedding.data;
      return Array.from({ length: batch }, (_, b) => unit(Array.from(data.slice(b * dims, (b + 1) * dims))));
    }
    const hidden = output.last_hidden_state;
    const [batch, length, dims] = hidden.dims;
    const mask = inputs.attention_mask.data;
    return Array.from({ length: batch }, (_, b) => {
      const vector = new Array(dims).fill(0);
      // Mean pooling sums every real token; CLS pooling keeps the first.
      for (let t = 0; t < (pool === "cls" ? 1 : length); t++) {
        if (!Number(mask[b * length + t])) continue;
        for (let d = 0; d < dims; d++) vector[d] += hidden.data[(b * length + t) * dims + d];
      }
      return unit(vector);
    });
  };
  return embed;
}

export function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
