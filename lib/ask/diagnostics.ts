import type { ProviderAttempt, ProviderName, ProviderUsage } from "./types.ts";

export type SourceDiagnostic = {
  source: "ga4" | "search-console";
  called: boolean;
  status: "success" | "empty" | "failure";
  durationMs?: number;
  failureCategory?: string;
};

export type AttemptDiagnostic = {
  provider: ProviderName;
  model: string;
  durationMs: number;
  succeeded: boolean;
  fallbackOccurred: boolean;
  failureCategory?: string;
  usage?: ProviderUsage;
  actualCostUsd?: number;
  estimatedCostUsd?: number;
};

export type AskDebugEntry = {
  requestId: string;
  kind: "ask" | "transcription";
  responseTimeMs: number;
  providerUsed?: ProviderName;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  fallbackAttempted: boolean;
  fallbackUsed: boolean;
  primaryFailureCategory?: string;
  attempts: AttemptDiagnostic[];
  sources: SourceDiagnostic[];
};

export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
};

export type ModelPricingMap = Record<string, ModelPricing>;

export function isDiagnosticsEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseModelPricing(value: string | undefined): ModelPricingMap {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const valid: ModelPricingMap = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (!/^(gemini|openrouter)\/[A-Za-z0-9._:/-]+$/.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const pricing = raw as Record<string, unknown>;
    if (!isFiniteNonNegative(pricing.inputUsdPerMillionTokens) || !isFiniteNonNegative(pricing.outputUsdPerMillionTokens)) continue;
    if (pricing.cachedInputUsdPerMillionTokens !== undefined && !isFiniteNonNegative(pricing.cachedInputUsdPerMillionTokens)) continue;
    valid[key] = {
      inputUsdPerMillionTokens: pricing.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: pricing.outputUsdPerMillionTokens,
      ...(typeof pricing.cachedInputUsdPerMillionTokens === "number"
        ? { cachedInputUsdPerMillionTokens: pricing.cachedInputUsdPerMillionTokens }
        : {}),
    };
  }
  return valid;
}

export function estimateAttemptCost(
  provider: ProviderName,
  model: string,
  usage: ProviderUsage | undefined,
  pricingMap: ModelPricingMap,
): number | undefined {
  const pricing = pricingMap[`${provider}/${model}`];
  if (!pricing || usage?.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  const cachedInputTokens = Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0);
  const regularInputTokens = usage.inputTokens - cachedInputTokens;
  const cachedInputPrice = pricing.cachedInputUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens;
  return (
    (regularInputTokens * pricing.inputUsdPerMillionTokens + cachedInputTokens * cachedInputPrice + usage.outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}

export function toAttemptDiagnostics(attempts: ProviderAttempt[], pricingMap: ModelPricingMap): AttemptDiagnostic[] {
  return attempts.map((attempt) => {
    const estimatedCostUsd = estimateAttemptCost(attempt.provider, attempt.model, attempt.usage, pricingMap);
    return {
      provider: attempt.provider,
      model: attempt.model,
      durationMs: attempt.durationMs,
      succeeded: attempt.succeeded,
      fallbackOccurred: attempt.fallbackOccurred,
      ...(attempt.failureType ? { failureCategory: attempt.failureType } : {}),
      ...(attempt.usage ? { usage: attempt.usage } : {}),
      ...(attempt.actualCostUsd !== undefined ? { actualCostUsd: attempt.actualCostUsd } : {}),
      ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
    };
  });
}

export function buildAskDebugEntry(input: {
  requestId: string;
  kind?: "ask" | "transcription";
  responseTimeMs: number;
  attempts: ProviderAttempt[];
  sources?: SourceDiagnostic[];
  pricingMap?: ModelPricingMap;
}): AskDebugEntry {
  const attempts = toAttemptDiagnostics(input.attempts, input.pricingMap ?? {});
  const successful = [...input.attempts].reverse().find((attempt) => attempt.succeeded);
  const primaryFailure = input.attempts.find((attempt) => !attempt.fallbackOccurred && !attempt.succeeded);
  const usage = successful?.usage;
  return {
    requestId: input.requestId,
    kind: input.kind ?? "ask",
    responseTimeMs: input.responseTimeMs,
    ...(successful ? { providerUsed: successful.provider, model: successful.model } : {}),
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    fallbackAttempted: input.attempts.some((attempt) => attempt.fallbackOccurred),
    fallbackUsed: input.attempts.some((attempt) => attempt.fallbackOccurred && attempt.succeeded),
    ...(primaryFailure?.failureType ? { primaryFailureCategory: primaryFailure.failureType } : {}),
    attempts,
    sources: input.sources ?? [],
  };
}

