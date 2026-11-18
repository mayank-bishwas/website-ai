export type AskRole = "user" | "assistant";

export type AskMessage = {
  id: string;
  role: AskRole;
  content: string;
};

export type CatalogProduct = {
  sku: string;
  name: string;
  description: string;
  variant: string;
  price: number;
  currency: string;
  availability: "in_stock" | "out_of_stock";
  familyName: string;
};

export type KnowledgeFact = {
  id: number;
  content: string;
};

export type AskEvidence = {
  source: "inventory" | "knowledge-base" | "website" | "ga4" | "search-console" | "conversations";
  sourceLabel: string;
  status: "available" | "empty" | "unavailable";
  data?: unknown;
  message?: string;
  note?: string;
};

export type ConversationTurn = {
  role: AskRole;
  content: string;
};

export type ProviderName = "gemini" | "openrouter";

export type ProviderAttempt = {
  provider: ProviderName;
  model: string;
  durationMs: number;
  fallbackOccurred: boolean;
  succeeded: boolean;
  failureType?: string;
  usage?: ProviderUsage;
  actualCostUsd?: number;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

export type ProviderInvocationResult = {
  text: string;
  usage?: ProviderUsage;
  actualCostUsd?: number;
};

export type ProviderConfig = {
  provider: ProviderName;
  model: string;
  apiKey?: string;
};

export type ProviderInvocationOptions = {
  signal?: AbortSignal;
  onToken?: (token: string) => void;
};

export type ProviderInvocation = (
  config: ProviderConfig,
  prompt?: string,
  options?: ProviderInvocationOptions,
) => Promise<string | ProviderInvocationResult>;

export type ProviderOperationalFailure = Error & {
  providerOperationalFailure: true;
  failureType: string;
  diagnosticDetails?: {
    status?: number;
    body?: string;
  };
  usage?: ProviderUsage;
  actualCostUsd?: number;
  partialText?: string;
};

export function createProviderOperationalFailure(
  failureType: string,
  details?: {
    usage?: ProviderUsage;
    actualCostUsd?: number;
    diagnosticDetails?: ProviderOperationalFailure["diagnosticDetails"];
    partialText?: string;
  },
): ProviderOperationalFailure {
  return Object.assign(new Error("Provider request failed."), {
    providerOperationalFailure: true as const,
    failureType,
    ...(details?.diagnosticDetails ? { diagnosticDetails: details.diagnosticDetails } : {}),
    ...(details?.usage ? { usage: details.usage } : {}),
    ...(details?.actualCostUsd !== undefined ? { actualCostUsd: details.actualCostUsd } : {}),
    ...(details?.partialText !== undefined ? { partialText: details.partialText } : {}),
  });
}

export function isProviderOperationalFailure(error: unknown): error is ProviderOperationalFailure {
  return Boolean(
    error &&
      typeof error === "object" &&
      "providerOperationalFailure" in error &&
      error.providerOperationalFailure === true &&
      "failureType" in error &&
      typeof error.failureType === "string",
  );
}
