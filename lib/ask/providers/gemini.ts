import { createProviderOperationalFailure } from "../types.ts";
import type { ProviderInvocationOptions, ProviderInvocationResult, ProviderUsage } from "../types.ts";
import { readSseData } from "./sse.ts";

type GeminiInput = {
  apiKey: string;
  model: string;
  systemInstruction: string;
  prompt: string;
};

export async function requestGemini(
  input: GeminiInput,
  fetcher: typeof fetch = fetch,
  options: ProviderInvocationOptions = {},
): Promise<ProviderInvocationResult> {
  if (!input.apiKey) throw createProviderOperationalFailure("not_configured");

  let response: Response;
  const timeoutSignal = AbortSignal.timeout(15_000);
  try {
    response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:${options.onToken ? "streamGenerateContent?alt=sse" : "generateContent"}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
        cache: "no-store",
      },
    );
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
  let truncated = false;
  const readPayload = (payload: unknown) => {
    const responsePayload = payload as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: unknown }>;
      usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown; cachedContentTokenCount?: unknown };
    };
    const candidate = responsePayload.candidates?.[0];
    const token = candidate?.content?.parts
      ?.map((part) => typeof part.text === "string" ? part.text : "")
      .join("") ?? "";
    if (token) {
      answer += token;
      options.onToken?.(token);
    }
    if (candidate?.finishReason === "MAX_TOKENS") truncated = true;
    const usageMetadata = responsePayload.usageMetadata;
    usage = {
      ...(validTokenCount(usageMetadata?.promptTokenCount) !== undefined ? { inputTokens: validTokenCount(usageMetadata?.promptTokenCount) } : {}),
      ...(validTokenCount(usageMetadata?.candidatesTokenCount) !== undefined ? { outputTokens: validTokenCount(usageMetadata?.candidatesTokenCount) } : {}),
      ...(validTokenCount(usageMetadata?.totalTokenCount) !== undefined ? { totalTokens: validTokenCount(usageMetadata?.totalTokenCount) } : {}),
      ...(validTokenCount(usageMetadata?.cachedContentTokenCount) !== undefined ? { cachedInputTokens: validTokenCount(usageMetadata?.cachedContentTokenCount) } : {}),
    };
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

  if (!answer.trim()) throw createProviderOperationalFailure("empty_response", { ...(Object.keys(usage).length ? { usage } : {}) });
  if (truncated) {
    throw createProviderOperationalFailure("truncated", {
      ...(Object.keys(usage).length ? { usage } : {}),
      partialText: answer.trim(),
    });
  }
  return { text: answer.trim(), ...(Object.keys(usage).length ? { usage } : {}) };
}

export async function transcribeGeminiAudio(input: {
  apiKey: string;
  model: string;
  mimeType: string;
  audioBase64: string;
}, fetcher: typeof fetch = fetch): Promise<ProviderInvocationResult> {
  if (!input.apiKey) throw createProviderOperationalFailure("not_configured");
  let response: Response;
  try {
    response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: "Transcribe the spoken words exactly. Return only the transcript, preserving the language used by the speaker." },
              { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 1_024 },
        }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      },
    );
  } catch (error) {
    throw createProviderOperationalFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error");
  }
  if (!response.ok) {
    const responseBody = await response.text();
    throw createProviderOperationalFailure(response.status === 429 ? "rate_limited" : `http_${response.status}`, {
      diagnosticDetails: {
        status: response.status,
        body: responseBody.replaceAll(input.apiKey, "[REDACTED]").slice(0, 2_000),
      },
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw createProviderOperationalFailure("invalid_response");
  }
  const responsePayload = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; audioTranscription?: { text?: unknown } }> } }>;
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown; cachedContentTokenCount?: unknown };
  };
  const transcript = responsePayload.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part.audioTranscription?.text === "string"
      ? part.audioTranscription.text
      : typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  const rawUsage = responsePayload.usageMetadata;
  const usage: ProviderUsage = {
    ...(validTokenCount(rawUsage?.promptTokenCount) !== undefined ? { inputTokens: validTokenCount(rawUsage?.promptTokenCount) } : {}),
    ...(validTokenCount(rawUsage?.candidatesTokenCount) !== undefined ? { outputTokens: validTokenCount(rawUsage?.candidatesTokenCount) } : {}),
    ...(validTokenCount(rawUsage?.totalTokenCount) !== undefined ? { totalTokens: validTokenCount(rawUsage?.totalTokenCount) } : {}),
    ...(validTokenCount(rawUsage?.cachedContentTokenCount) !== undefined ? { cachedInputTokens: validTokenCount(rawUsage?.cachedContentTokenCount) } : {}),
  };
  if (!transcript) throw createProviderOperationalFailure("empty_response", { ...(Object.keys(usage).length ? { usage } : {}) });
  return { text: transcript, ...(Object.keys(usage).length ? { usage } : {}) };
}

function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
