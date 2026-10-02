import "server-only";

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAnthropicProvider } from "@/lib/ai/anthropic-provider";
import { createMockProvider } from "@/lib/ai/mock-provider";
import { DEFAULT_AI_MODEL } from "@/lib/config";
import type { AiMode } from "@/lib/types";

export type Effort = "low" | "medium" | "high";

export interface AiRequest {
  /** Stable instructions. */
  system: string;
  /** Per-repo context shared by many requests; marked for prompt caching. */
  context?: string;
  /** The varying part: one file, one folder, or the overview evidence. */
  prompt: string;
  effort: Effort;
  maxTokens: number;
  /** JSON Schema for structured output; the reply text is then JSON. */
  jsonSchema?: Record<string, unknown>;
  /** What the dev-only mock provider streams instead of calling a model. */
  mock: string;
  signal?: AbortSignal;
}

export interface AiResult {
  text: string;
  /** Model that actually answered (differs from the requested one after a fallback). */
  model: string;
}

export interface AiProvider {
  mode: Exclude<AiMode, "off">;
  /** Requested model; part of cache keys so switching models regenerates. */
  model: string;
  /** Streams text deltas to `onText`; resolves with the full reply. Throws RepoMapError. */
  stream(request: AiRequest, onText: (delta: string) => void): Promise<AiResult>;
}

const globalForAi = globalThis as unknown as { __repomapAi?: AiProvider | null };

/**
 * The configured provider, or null when AI is off. REPOMAP_AI_MOCK=1 selects a
 * fake provider for local development (never set it in production).
 */
export function getAiProvider(): AiProvider | null {
  if (globalForAi.__repomapAi !== undefined) return globalForAi.__repomapAi;
  const model = process.env.REPOMAP_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  let provider: AiProvider | null = null;
  if (process.env.REPOMAP_AI_MOCK === "1") provider = createMockProvider();
  else if (hasAnthropicCredentials()) provider = createAnthropicProvider(model);
  globalForAi.__repomapAi = provider;
  return provider;
}

export function aiMode(): AiMode {
  return getAiProvider()?.mode ?? "off";
}

/**
 * The SDK resolves credentials lazily (env vars, then `ant auth login`
 * profiles), so check the same sources up front instead of failing per request.
 */
function hasAnthropicCredentials(): boolean {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_PROFILE?.trim()) return true;
  if (env.ANTHROPIC_FEDERATION_RULE_ID && (env.ANTHROPIC_IDENTITY_TOKEN || env.ANTHROPIC_IDENTITY_TOKEN_FILE)) return true;
  return existsSync(path.join(os.homedir(), ".config", "anthropic"));
}
