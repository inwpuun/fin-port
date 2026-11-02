import "server-only";
import { randomUUID } from "node:crypto";
import type { LineConfig } from "@/lib/env";

/**
 * The smallest LINE Messaging API client that does the job: a stateless
 * channel access token from the channel ID and secret, then a push (when
 * LINE_TO names a recipient) or a broadcast to every friend of the bot.
 */

const API = "https://api.line.me";
const TIMEOUT_MS = 15_000;
/** LINE rejects a text message longer than this. */
export const LINE_TEXT_LIMIT = 5000;

async function lineFetch(path: string, init: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.ok) return response;
  const body = await response.text().catch(() => "");
  throw new Error(`LINE ${path} returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
}

async function issueToken(config: LineConfig): Promise<string> {
  const response = await lineFetch("/oauth2/v3/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.channelId,
      client_secret: config.channelSecret
    })
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("LINE issued no access token");
  return payload.access_token;
}

/** Sends up to five text bubbles in one request, which LINE counts as one message. */
export async function sendLineText(config: LineConfig, texts: string[]) {
  const messages = texts.slice(0, 5).map((text) => ({ type: "text", text: text.slice(0, LINE_TEXT_LIMIT) }));
  if (!messages.length) return;

  const token = await issueToken(config);
  const path = config.to ? "/v2/bot/message/push" : "/v2/bot/message/broadcast";

  await lineFetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      // Lets LINE drop a duplicate if this exact request is ever replayed.
      "x-line-retry-key": randomUUID()
    },
    body: JSON.stringify(config.to ? { to: config.to, messages } : { messages })
  });
}
