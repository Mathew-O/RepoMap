import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { toAiError } from "@/lib/ai/errors";
import type { AiProvider, AiRequest, AiResult } from "@/lib/ai/provider";
import { RepoMapError } from "@/lib/github/errors";

/**
 * Claude via the official SDK. Every request:
 * - streams, so long overviews never hit HTTP timeouts;
 * - opts into server-side refusal fallbacks ("default" routes a declined request
 *   to Anthropic's recommended model for that refusal category);
 * - marks the per-repo context block for prompt caching, so summarizing many
 *   files of one repo re-reads the shared prefix at cache prices.
 * Thinking stays at the model's adaptive default; `effort` sets the depth.
 */
export function createAnthropicProvider(model: string): AiProvider {
  const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

  async function stream(request: AiRequest, onText: (delta: string) => void): Promise<AiResult> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: request.system }];
    if (request.context) system.push({ type: "text", text: request.context, cache_control: { type: "ephemeral" } });

    try {
      const response = client.beta.messages.stream(
        {
          model,
          max_tokens: request.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: {
            effort: request.effort,
            ...(request.jsonSchema ? { format: { type: "json_schema" as const, schema: request.jsonSchema } } : {}),
          },
        },
        { signal: request.signal },
      );
      response.on("text", (delta) => onText(delta));
      const message = await response.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new RepoMapError("AI_REFUSED", "The AI model declined to describe this content.", {
          hint: "This sometimes happens with security tooling or unusual files.",
        });
      }
      return { text: finalText(message.content), model: message.model };
    } catch (err) {
      throw toAiError(err);
    }
  }

  return { mode: "on", model, stream };
}

/**
 * Text of the answer. After a server-side fallback the content holds a
 * `fallback` marker per model that declined; only text after the last one
 * belongs to the model that finished the answer.
 */
function finalText(content: Anthropic.Beta.BetaContentBlock[]): string {
  let start = 0;
  content.forEach((block, i) => {
    if ((block.type as string) === "fallback") start = i + 1;
  });
  return content
    .slice(start)
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}
