#!/usr/bin/env node
// Probe candidate endpoints to find which one the configured token accepts.
// Reads MINIMAX_API_KEY from .env. Prints a short summary line per candidate
// and exits 0 once the first 200 is found.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const key = process.env.MINIMAX_API_KEY;
if (!key) {
  console.error("MINIMAX_API_KEY not set");
  process.exit(2);
}

// Mask for any debug output.
const masked = `${key.slice(0, 8)}…${key.slice(-4)}`;
console.log(`probing with token ${masked}`);

const candidates = [
  // OpenAI-compatible (most proxy services)
  {
    name: "minimax.io/v1/chat/completions (openai-compatible)",
    url: "https://api.minimax.io/v1/chat/completions",
    body: {
      model: "MiniMax-Text-01",
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 8,
    },
    parse: (j) => j?.choices?.[0]?.message?.content,
  },
  {
    name: "minimaxi.chat/v1/text/chatcompletion_v2 (native)",
    url: "https://api.minimaxi.chat/v1/text/chatcompletion_v2",
    body: {
      model: "MiniMax-Text-01",
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 8,
    },
    parse: (j) =>
      j?.choices?.[0]?.message?.content ??
      j?.reply ??
      j?.choices?.[0]?.messages?.[0]?.text,
  },
  {
    name: "minimax.chat/v1/text/chatcompletion_v2 (native legacy)",
    url: "https://api.minimax.chat/v1/text/chatcompletion_v2",
    body: {
      model: "MiniMax-Text-01",
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 8,
    },
    parse: (j) => j?.choices?.[0]?.message?.content ?? j?.reply,
  },
  {
    name: "api.chatanywhere.tech (proxy)",
    url: "https://api.chatanywhere.tech/v1/chat/completions",
    body: {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 8,
    },
    parse: (j) => j?.choices?.[0]?.message?.content,
  },
  {
    name: "api.openai.com (in case key is OpenAI)",
    url: "https://api.openai.com/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
      max_tokens: 8,
    },
    parse: (j) => j?.choices?.[0]?.message?.content,
  },
];

let winner = null;
for (const c of candidates) {
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(c.body),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const content = parsed ? c.parse(parsed) : null;
    const short = (text.length > 240 ? text.slice(0, 240) + "…" : text).replace(/\n/g, " ");
    console.log(`[${res.status}] ${c.name} -> ${content ?? short}`);
    if (res.status === 200 && content) {
      winner = { name: c.name, url: c.url, body: c.body, content };
      break;
    }
  } catch (e) {
    console.log(`[ERR ] ${c.name} -> ${e.message}`);
  }
}

if (winner) {
  console.log(`\nWINNER: ${winner.name}`);
  console.log(`URL:    ${winner.url}`);
  console.log(`MODEL:  ${winner.body.model}`);
  console.log(`REPLY:  ${winner.content}`);
  process.exit(0);
}
console.log("\nNo endpoint accepted the token.");
process.exit(1);
