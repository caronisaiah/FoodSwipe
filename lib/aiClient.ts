/**
 * Tag Automation B4 — tiny, isolated AI provider adapter (server-only).
 *
 * A single function that asks an LLM for STRICT JSON, behind one env var. Uses the
 * Anthropic Messages API over `fetch` (no SDK dependency). The API key is read
 * server-side from `ANTHROPIC_API_KEY` and NEVER returned to the client or logged.
 * Callers MUST validate/sanitize the returned JSON before trusting it.
 *
 * Deliberately minimal: no multi-provider abstraction, no streaming, no tools.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

export class AINotConfiguredError extends Error {}

export function isAIConfigured(): boolean {
  return Boolean((process.env.ANTHROPIC_API_KEY ?? "").trim());
}

function aiModel(): string {
  return (process.env.FOODSWIPE_AI_MODEL ?? "").trim() || DEFAULT_MODEL;
}

/** Extract the first balanced top-level JSON object from model text. */
function parseJsonObject(text: string): unknown {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON.");
  return JSON.parse(t.slice(start, end + 1));
}

/**
 * Ask the model for JSON. Returns parsed (UNVALIDATED) JSON — the caller must
 * validate it. Throws AINotConfiguredError when no key is set.
 */
export async function completeJson(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new AINotConfiguredError("ANTHROPIC_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: aiModel(),
        max_tokens: opts.maxTokens ?? 1200,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
    });
    if (!res.ok) {
      // Never include the response body verbatim (avoid leaking anything); status only.
      throw new Error(`AI provider returned HTTP ${res.status}.`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).map((c) => (typeof c.text === "string" ? c.text : "")).join("");
    return parseJsonObject(text);
  } finally {
    clearTimeout(timer);
  }
}

export function aiModelName(): string {
  return aiModel();
}
