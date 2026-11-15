import { createProviderOperationalFailure } from "../types.ts";
import type { ProviderInvocationOptions, ProviderInvocationResult, ProviderUsage } from "../types.ts";
import { readSseData } from "./sse.ts";

type OpenRouterInput = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  prompt: string;
};

export async function requestOpenRouter(
  input: OpenRouterInput,
  fetcher: typeof fetch = fetch,
  options: ProviderInvocationOptions = {},
): Promise<ProviderInvocationResult> {
  if (!input.apiKey) throw createProviderOperationalFailure("not_configured");

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(15_000);
  try {
    response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Shahi Meva Website Assistant",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.systemInstruction },
          { role: "user", content: input.prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
        usage: { include: true },
        ...(options.onToken ? { stream: true } : {}),
      }),
      signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw createProviderOperationalFailure(
      timeoutSignal.aborted ? "timeout" : "network_error",
    );
  }

  if (!response.ok) {
    throw createProviderOperationalFailure(
      response.status === 429 ? "rate_limited" : `http_${response.status}`,
    );
  }

  let answer = "";
  let usage: ProviderUsage = {};
  let actualCostUsd: number | undefined;
  let truncated = false;
  const readPayload = (payload: unknown) => {
    const responsePayload = payload as {
      choices?: Array<{
        message?: { content?: unknown };
        delta?: { content?: unknown };
        finish_reason?: string;
      }>;
      usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown };
      cost?: unknown;
      };
    };
    const choice = responsePayload.choices?.[0];
    const delta = choice?.delta?.content;
    const complete = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    const token = typeof delta === "string" ? delta : typeof complete === "string" ? complete : "";
    if (token) {
      answer += token;
      options.onToken?.(token);
    }
    if (finishReason === "length") truncated = true;
    const rawUsage = responsePayload.usage;
    usage = {
      ...(validTokenCount(rawUsage?.prompt_tokens) !== undefined ? { inputTokens: validTokenCount(rawUsage?.prompt_tokens) } : {}),
      ...(validTokenCount(rawUsage?.completion_tokens) !== undefined ? { outputTokens: validTokenCount(rawUsage?.completion_tokens) } : {}),
      ...(validTokenCount(rawUsage?.total_tokens) !== undefined ? { totalTokens: validTokenCount(rawUsage?.total_tokens) } : {}),
      ...(validTokenCount(rawUsage?.prompt_tokens_details?.cached_tokens) !== undefined ? { cachedInputTokens: validTokenCount(rawUsage?.prompt_tokens_details?.cached_tokens) } : {}),
    };
    actualCostUsd = typeof rawUsage?.cost === "number" && Number.isFinite(rawUsage.cost) && rawUsage.cost >= 0 ? rawUsage.cost : undefined;
  };

  if (options.onToken) {
    try {
      await readSseData(response, (data) => {
        if (data === "[DONE]") return;
        try {
          readPayload(JSON.parse(data));
        } catch (error) {
          if (error instanceof SyntaxError) throw createProviderOperationalFailure("invalid_response");
          throw error;
        }
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error && typeof error === "object" && "providerOperationalFailure" in error) throw error;
      throw createProviderOperationalFailure("invalid_response");
    }
  } else {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw createProviderOperationalFailure("invalid_response");
    }
    readPayload(payload);
  }

  if (!answer.trim()) {
    throw createProviderOperationalFailure("empty_response", {
      ...(Object.keys(usage).length ? { usage } : {}),
      ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
    });
  }
  if (truncated) {
    throw createProviderOperationalFailure("truncated", {
      ...(Object.keys(usage).length ? { usage } : {}),
      ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
      partialText: answer.trim(),
    });
  }
  return {
    text: answer.trim(),
    ...(Object.keys(usage).length ? { usage } : {}),
    ...(actualCostUsd !== undefined ? { actualCostUsd } : {}),
  };
}

function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
