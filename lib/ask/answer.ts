import { runWithFallback, AllProvidersFailedError } from "./fallback.ts";
import { buildAskPrompt } from "./prompt.ts";
import { detectAskLanguage, isContactRequest } from "./scope.ts";
import type {
  AskEvidence,
  CatalogProduct,
  ConversationTurn,
  KnowledgeFact,
  ProviderAttempt,
  ProviderConfig,
  ProviderInvocation,
  ProviderInvocationOptions,
} from "./types.ts";

type AnswerAskInput = {
  question: string;
  history: ConversationTurn[];
  getCatalog?: () => Promise<CatalogProduct[]>;
  getKnowledge?: () => Promise<KnowledgeFact[]>;
  getWebsiteContent?: () => Promise<{ source_url: string; content: string }[]>;
  primary: ProviderConfig;
  fallback: ProviderConfig;
  invoke: ProviderInvocation;
  signal?: AbortSignal;
  onToken?: ProviderInvocationOptions["onToken"];
  onReset?: () => void;
  onAttempt?: (attempt: ProviderAttempt) => void;
};

function failureReply(question: string): string {
  const replies = {
    en: "I’m having trouble right now. Please try again in a moment.",
    hi: "अभी जवाब नहीं मिल पाया। कृपया थोड़ी देर बाद फिर कोशिश करें।",
    ar: "تعذّر إعداد الإجابة الآن. يُرجى المحاولة مرة أخرى بعد قليل.",
    bn: "এখন উত্তর দিতে সমস্যা হচ্ছে। অনুগ্রহ করে একটু পরে আবার চেষ্টা করুন।",
    gu: "હમણાં જવાબ આપવામાં મુશ્કેલી આવી રહી છે. કૃપા કરીને થોડીવાર પછી ફરી પ્રયાસ કરો.",
    zh: "现在暂时无法回答，请稍后再试。",
    ja: "ただいま回答できません。少ししてからもう一度お試しください。",
    ko: "지금은 답변하기 어렵습니다. 잠시 후 다시 시도해 주세요.",
    es: "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.",
    fr: "Je ne peux pas répondre pour le moment. Veuillez réessayer dans un instant.",
    de: "Ich kann gerade nicht antworten. Bitte versuchen Sie es gleich noch einmal.",
    pt: "Não consigo responder agora. Tente novamente daqui a pouco.",
  } satisfies Record<ReturnType<typeof detectAskLanguage>, string>;
  return replies[detectAskLanguage(question)];
}

function inventoryEvidence(catalog: CatalogProduct[]): AskEvidence {
  return catalog.length
    ? { source: "inventory", sourceLabel: "Shahi Meva published inventory", status: "available", data: catalog }
    : {
      source: "inventory",
      sourceLabel: "Shahi Meva published inventory",
      status: "empty",
      data: [],
      message: "There are no published products in the available catalog.",
    };
}

export type AnswerResult = {
  answer: string;
  status: "completed" | "failed";
  attempts: ProviderAttempt[];
  contactOffered?: boolean;
};

export async function answerAsk(input: AnswerAskInput): Promise<AnswerResult> {
  const evidence: AskEvidence[] = [];
  // Load the three evidence sources concurrently; each failure is isolated.
  const [catalogResult, knowledgeResult, websiteResult] = await Promise.allSettled([
    (async () => {
      if (!input.getCatalog) throw new Error("Inventory loader unavailable.");
      return input.getCatalog();
    })(),
    (async () => (input.getKnowledge ? input.getKnowledge() : []))(),
    (async () => (input.getWebsiteContent ? input.getWebsiteContent() : []))(),
  ]);

  if (catalogResult.status === "fulfilled") {
    evidence.push(inventoryEvidence(catalogResult.value));
  } else {
    evidence.push({
      source: "inventory",
      sourceLabel: "Shahi Meva published inventory",
      status: "unavailable",
      message: "The published inventory could not be read.",
    });
  }

  if (knowledgeResult.status === "fulfilled") {
    const knowledge = knowledgeResult.value;
    evidence.push({
      source: "knowledge-base",
      sourceLabel: "Shahi Meva published Knowledge Base",
      status: knowledge.length ? "available" : "empty",
      data: knowledge,
      ...(knowledge.length ? {} : { message: "There are no published Knowledge Base entries in this page session." }),
    });
  } else {
    evidence.push({
      source: "knowledge-base",
      sourceLabel: "Shahi Meva published Knowledge Base",
      status: "unavailable",
      message: "The published Knowledge Base could not be read.",
    });
  }

  if (websiteResult.status === "fulfilled") {
    const website = websiteResult.value;
    evidence.push({
      source: "website",
      sourceLabel: "Shahi Meva published website content",
      status: website.length ? "available" : "empty",
      data: website,
      ...(website.length ? {} : { message: "There are no active website content records in this page session." }),
    });
  } else {
    evidence.push({
      source: "website",
      sourceLabel: "Shahi Meva published website content",
      status: "unavailable",
      message: "The published website content could not be read.",
    });
  }

  const prompt = buildAskPrompt(input.question, evidence, input.history);
  try {
    const result = await runWithFallback({
      primary: input.primary,
      fallback: input.fallback,
      invoke: (config, _unused, options) => input.invoke(config, prompt, options),
      signal: input.signal,
      onToken: input.onToken,
      onReset: input.onReset,
      onAttempt: input.onAttempt,
    });
    const cannotConfirm = /\b(can(?:not|'t) confirm|couldn.t find|not (?:listed|available) in|don't have (?:that|this) information)\b/i.test(result.answer) ||
      /पुष्टि नहीं|नहीं मिल|जानकारी नहीं है|उपलब्ध नहीं/i.test(result.answer);
    return {
      answer: result.answer,
      status: "completed",
      attempts: result.attempts,
      ...(isContactRequest(input.question) || cannotConfirm ? { contactOffered: true } : {}),
    };
  } catch (error) {
    if (!(error instanceof AllProvidersFailedError)) throw error;
    return {
      answer: failureReply(input.question),
      status: "failed",
      attempts: error.attempts,
    };
  }
}
