import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublishedCatalog } from "@/lib/ask/catalog";
import { getPublishedKnowledgeEntries, getActiveWebsiteContent } from "@/lib/ask/catalog";
import { answerAsk } from "@/lib/ask/answer";
import { isSameOriginRequest } from "@/lib/ask/access";
import { requestGemini } from "@/lib/ask/providers/gemini";
import { requestOpenRouter } from "@/lib/ask/providers/openrouter";
import { ASK_SYSTEM_INSTRUCTION } from "@/lib/ask/prompt";
import type {
  ConversationTurn,
  KnowledgeFact,
  ProviderConfig,
  AskEvidence,
} from "@/lib/ask/types";
import { countKnowledgeWords } from "@/lib/portal-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 150_000;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_KNOWLEDGE_ENTRIES = 500;
const MAX_KNOWLEDGE_CHARS = 30_000;
const REQUESTS_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;
const rateWindow = { startedAt: 0, count: 0 };

function isRateLimited(): boolean {
  const now = Date.now();
  if (now - rateWindow.startedAt >= RATE_WINDOW_MS) {
    rateWindow.startedAt = now;
    rateWindow.count = 0;
  }
  rateWindow.count += 1;
  return rateWindow.count > REQUESTS_PER_MINUTE;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function getProviderConfigs(): { primary: ProviderConfig; fallback: ProviderConfig } {
  return {
    primary: {
      provider: "gemini",
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      apiKey: process.env.GEMINI_API_KEY,
    },
    fallback: {
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash-1017",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  };
}

function logProviderAttempt(attempt: {
  provider: string;
  model: string;
  durationMs: number;
  fallbackOccurred: boolean;
  succeeded: boolean;
  failureType?: string;
}) {
  console.info("[ask] provider_attempt", {
    provider: attempt.provider,
    model: attempt.model,
    duration_ms: attempt.durationMs,
    fallback_occurred: attempt.fallbackOccurred,
    succeeded: attempt.succeeded,
    failure_type: attempt.failureType,
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (isRateLimited()) return json({ error: "Please wait a moment before trying again." }, 429);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Send a text question as JSON." }, 415);
  }

  const bodyText = await readBoundedBody(request);
  if (bodyText === null) return json({ error: "That request is too large." }, 413);

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "The request must be a JSON object." }, 400);
  }
  const requestBody = body as { question?: unknown; history?: unknown; knowledge?: unknown };
  const question = requestBody.question;
  if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION_CHARS) {
    return json({ error: `Enter a question of up to ${MAX_QUESTION_CHARS} characters.` }, 400);
  }
  const rawHistory = requestBody.history ?? [];
  if (!Array.isArray(rawHistory) || rawHistory.length > MAX_HISTORY_MESSAGES) {
    return json({ error: `Conversation context must contain at most ${MAX_HISTORY_MESSAGES} messages.` }, 400);
  }
  const history: ConversationTurn[] = [];
  for (const item of rawHistory) {
    if (
      !item ||
      typeof item !== "object" ||
      !("role" in item) ||
      !("content" in item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      !item.content.trim() ||
      item.content.length > MAX_QUESTION_CHARS
    ) {
      return json({ error: "Conversation context contains an invalid message." }, 400);
    }
    history.push({ role: item.role, content: item.content.trim() });
  }
  const exactQuestion = question.trim();
  const { primary, fallback } = getProviderConfigs();

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const streamAbort = new AbortController();
  const signal = AbortSignal.any([request.signal, streamAbort.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      const send = (event: unknown) => {
        if (signal.aborted || !streamController) return;
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let hasTokens = false;
      void answerAsk({
        question: exactQuestion,
        history,
        getCatalog: () => getPublishedCatalog(createSupabaseServerClient()),
        getKnowledge: () => getPublishedKnowledgeEntries(createSupabaseServerClient()),
        getWebsiteContent: () => getActiveWebsiteContent(createSupabaseServerClient()),
        primary,
        fallback,
        signal,
        onToken: (token) => {
          hasTokens = true;
          send({ type: "token", token });
        },
        onReset: () => {
          if (!hasTokens) return;
          hasTokens = false;
          send({ type: "reset" });
        },
        invoke: async (config, prompt, options) => {
          if (!config.apiKey) {
            return Promise.reject(
              Object.assign(new Error("Provider not configured."), {
                providerOperationalFailure: true as const,
                failureType: "not_configured",
              }),
            );
          }
          const common = {
            apiKey: config.apiKey,
            model: config.model,
            systemInstruction: ASK_SYSTEM_INSTRUCTION,
            prompt: prompt ?? "",
          };
          return config.provider === "gemini"
            ? requestGemini(common, fetch, options)
            : requestOpenRouter(common, fetch, options);
        },
        onAttempt: logProviderAttempt,
      }).then((result) => {
        if (!hasTokens) send({ type: "answer", answer: result.answer });
        send({ type: "done", contactOffered: result.contactOffered ?? false });
      }).catch(() => {
        send({ type: "error" });
      }).finally(() => {
        try {
          streamController?.close();
        } catch {
          streamController = null;
        }
      });
    },
    cancel() {
      streamAbort.abort();
      streamController = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
