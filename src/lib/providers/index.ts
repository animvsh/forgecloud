import { createMiniMaxProvider } from "./minimax";
import { createAnthropicProvider } from "./anthropic";
import type { LLMProvider } from "./types";

export type { CompleteOptions, ChatMessage, LLMProvider } from "./types";

let cached: LLMProvider | null | undefined;

/**
 * Resolves the active LLM provider in this order:
 *  1. AI_PROVIDER env var (minimax | anthropic | fallback)
 *  2. Whichever credential is configured (MiniMax first)
 *  3. null, which signals fallback/template mode
 */
export function getProvider(): LLMProvider | null {
  if (cached !== undefined) return cached;
  const explicit = (process.env.AI_PROVIDER ?? "").toLowerCase().trim();

  if (explicit === "fallback") {
    cached = null;
    return cached;
  }
  if (explicit === "anthropic") {
    cached = createAnthropicProvider() ?? createMiniMaxProvider() ?? null;
    return cached;
  }
  if (explicit === "minimax") {
    cached = createMiniMaxProvider() ?? createAnthropicProvider() ?? null;
    return cached;
  }
  // No explicit choice — prefer MiniMax then Anthropic then fallback.
  cached = createMiniMaxProvider() ?? createAnthropicProvider() ?? null;
  return cached;
}

export function getProviderName(): string {
  return getProvider()?.name ?? "Fallback";
}

export function isProviderAvailable(): boolean {
  return getProvider() !== null;
}

export function resetProviderCache(): void {
  cached = undefined;
}
