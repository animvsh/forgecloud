export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type CompleteOptions = {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Hint for which sub-model to use within a provider (e.g. "fast" vs "smart"). */
  intent?: "plan" | "summary" | "risk" | "narrate" | "explain" | "task";
};

export interface LLMProvider {
  /** Display name for logs and the UI banner. */
  readonly name: string;
  /** Whether the provider is configured with credentials and ready to call. */
  readonly available: boolean;
  /** Best-effort current model identifier (for diagnostics / agent rows). */
  readonly primaryModel: string;
  readonly fallbackModel: string;
  /** Send a chat-completion request. Returns the text content of the first choice. */
  complete(opts: CompleteOptions): Promise<string>;
}
