import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/provider";

const WORD_DELAY_MS = 12;

/**
 * Local-development stand-in, enabled only by REPOMAP_AI_MOCK=1. It streams
 * the request's `mock` text word by word so the streaming UI can be exercised
 * without an API key. Its output is labeled as mock in the UI and cached under
 * its own model name, so it never mixes with real summaries.
 */
export function createMockProvider(): AiProvider {
  async function stream(request: AiRequest, onText: (delta: string) => void): Promise<AiResult> {
    const parts = request.mock.match(/\S+\s*/g) ?? [];
    for (const part of parts) {
      if (request.signal?.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, WORD_DELAY_MS));
      onText(part);
    }
    return { text: request.mock.trim(), model: "mock" };
  }
  return { mode: "mock", model: "mock", stream };
}
