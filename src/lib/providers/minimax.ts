import type { CompleteOptions, LLMProvider } from "./types";

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_PRIMARY = "MiniMax-Text-01";
// M1 is a reasoning model with <think> tags; we strip them. Useful for harder tasks.
const DEFAULT_FALLBACK = "MiniMax-M1";

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export function createMiniMaxProvider(): LLMProvider | null {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.MINIMAX_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const primaryModel = process.env.MINIMAX_MODEL ?? DEFAULT_PRIMARY;
  const fallbackModel = process.env.MINIMAX_FALLBACK_MODEL ?? DEFAULT_FALLBACK;

  async function complete(opts: CompleteOptions): Promise<string> {
    const messages = opts.system
      ? [{ role: "system" as const, content: opts.system }, ...opts.messages]
      : opts.messages;

    const body = {
      model: primaryModel,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`MiniMax ${res.status}: ${errText.slice(0, 400)}`);
    }

    const json: {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    } = await res.json();

    const raw = json.choices?.[0]?.message?.content ?? "";
    return stripThinkTags(raw);
  }

  return {
    name: "MiniMax",
    available: true,
    primaryModel,
    fallbackModel,
    complete,
  };
}
