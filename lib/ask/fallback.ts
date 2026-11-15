import {
  isProviderOperationalFailure,
  type ProviderAttempt,
  type ProviderConfig,
  type ProviderInvocation,
  type ProviderInvocationOptions,
} from "./types.ts";

type RunWithFallbackInput = {
  primary: ProviderConfig;
  fallback: ProviderConfig;
  invoke: ProviderInvocation;
  onAttempt?: (attempt: ProviderAttempt) => void;
  signal?: AbortSignal;
  onToken?: ProviderInvocationOptions["onToken"];
  onReset?: () => void;
  now?: () => number;
};

export class AllProvidersFailedError extends Error {
  readonly attempts: ProviderAttempt[];

  constructor(attempts: ProviderAttempt[]) {
    super("All configured ASK providers failed.");
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

export async function runWithFallback({
  primary,
  fallback,
  invoke,
  onAttempt,
  signal,
  onToken,
  onReset,
  now = Date.now,
}: RunWithFallbackInput): Promise<{ answer: string; attempts: ProviderAttempt[] }> {
  const attempts: ProviderAttempt[] = [];

  for (const [config, fallbackOccurred] of [[primary, false], [fallback, true]] as const) {
    if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
    const startedAt = now();
    try {
      const options = { ...(signal ? { signal } : {}), ...(onToken ? { onToken } : {}) };
      const answer = await invoke(config, undefined, options);
      const text = typeof answer === "string" ? answer : answer.text;
      if (!text.trim()) {
        const failure = Object.assign(new Error("Provider returned an empty answer."), {
          providerOperationalFailure: true as const,
          failureType: "empty_response",
        });
        throw failure;
      }
      const attempt: ProviderAttempt = {
        provider: config.provider,
        model: config.model,
        durationMs: Math.max(0, now() - startedAt),
        fallbackOccurred,
        succeeded: true,
        ...(typeof answer === "string" ? {} : answer.usage ? { usage: answer.usage } : {}),
        ...(typeof answer === "string" ? {} : answer.actualCostUsd !== undefined ? { actualCostUsd: answer.actualCostUsd } : {}),
      };
      attempts.push(attempt);
      onAttempt?.(attempt);
      return { answer: text.trim(), attempts };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (!isProviderOperationalFailure(error)) throw error;
      onReset?.();
      const attempt: ProviderAttempt = {
        provider: config.provider,
        model: config.model,
        durationMs: Math.max(0, now() - startedAt),
        fallbackOccurred,
        succeeded: false,
        failureType: error.failureType,
        ...(error.usage ? { usage: error.usage } : {}),
        ...(error.actualCostUsd !== undefined ? { actualCostUsd: error.actualCostUsd } : {}),
      };
      attempts.push(attempt);
      onAttempt?.(attempt);
    }
  }

  throw new AllProvidersFailedError(attempts);
}
