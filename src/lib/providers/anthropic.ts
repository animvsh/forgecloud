import Anthropic from "@anthropic-ai/sdk";
import type { CompleteOptions, LLMProvider } from "./types";

const PRIMARY = "claude-sonnet-4-6";
const FALLBACK = "claude-haiku-4-5-20251001";

export function createAnthropicProvider(): LLMProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });

  async function complete(opts: CompleteOptions): Promise<string> {
    const response = await client.messages.create({
      model: PRIMARY,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature,
      system: opts.system,
      messages: opts.messages.map((m) => ({
        role: m.role === "system" ? "user" : m.role,
        content: m.content,
      })),
    });
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();
  }

  return {
    name: "Anthropic",
    available: true,
    primaryModel: PRIMARY,
    fallbackModel: FALLBACK,
    complete,
  };
}
