/**
 * Tiny in-memory token bucket. Per-key (usually IP+route).
 * Not durable, not distributed — fine for a single-instance demo.
 */

type Bucket = { tokens: number; updatedAt: number };

const BUCKETS = new Map<string, Bucket>();

export type RateLimitConfig = {
  /** Maximum tokens in the bucket. */
  capacity: number;
  /** Tokens added per millisecond. */
  refillPerMs: number;
};

export function consume(
  key: string,
  cfg: RateLimitConfig,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = BUCKETS.get(key);
  const bucket: Bucket = existing
    ? {
        tokens: Math.min(
          cfg.capacity,
          existing.tokens + (now - existing.updatedAt) * cfg.refillPerMs,
        ),
        updatedAt: now,
      }
    : { tokens: cfg.capacity, updatedAt: now };

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    BUCKETS.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }

  BUCKETS.set(key, bucket);
  const deficit = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(deficit / cfg.refillPerMs);
  return { allowed: false, retryAfterMs };
}

// Common configs.
export const RATE_CONFIGS = {
  // 30 requests / minute steady-state, burst of 10
  expensive: { capacity: 10, refillPerMs: 30 / 60_000 } satisfies RateLimitConfig,
  // 120 requests / minute steady-state, burst of 30
  cheap: { capacity: 30, refillPerMs: 120 / 60_000 } satisfies RateLimitConfig,
};

export function clientKey(
  req: {
    headers: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
  },
  route: string,
): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(fwd) ? fwd[0] : typeof fwd === "string" ? fwd.split(",")[0] : undefined) ??
    req.socket?.remoteAddress ??
    "unknown";
  return `${ip}:${route}`;
}
