import { randomUUID } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: Level, message: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

export function newRequestId(): string {
  // Compact request id: r-<hex8>
  return `r-${randomUUID().slice(0, 8)}`;
}
