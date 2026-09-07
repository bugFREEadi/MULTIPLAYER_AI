export const EMBEDDING_DIMS = 1536;

function isMockAiEnabled() {
  return process.env.MOCK_AI_RESPONSES !== "false";
}

/**
 * Deterministic mock embedding for Step 18.
 * Same tokens → similar vectors so lexical overlap ranks higher in cosine search.
 * This is NOT a substitute for a real embedding model.
 */
export function mockEmbedText(text: string): number[] {
  const dims = EMBEDDING_DIMS;
  const v = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const a = (h >>> 0) % dims;
    const b = ((h * 2654435761) >>> 0) % dims;
    v[a] += 1;
    v[b] += 0.5;
  }

  let norm = 0;
  for (const n of v) norm += n * n;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) v[i] /= norm;
  return v;
}

export function embeddingToSqlLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed text for memory store/retrieve.
 * Mock mode: deterministic bag-of-tokens vector.
 * Real mode: embedding provider not wired yet — falls back to mock with a warning.
 */
export async function embedText(text: string): Promise<number[]> {
  if (isMockAiEnabled()) {
    return mockEmbedText(text);
  }

  console.warn(
    "[memory] Real embedding provider not configured — using mockEmbedText"
  );
  return mockEmbedText(text);
}
