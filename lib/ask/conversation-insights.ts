import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationMessage = {
  session_id: string;
  sender: "customer" | "assistant";
  message_text: string;
  status: string;
  created_at: string;
};

export type TopicCategory =
  | "frequent-products"
  | "common-questions"
  | "complaints"
  | "unanswered"
  | "product-requests"
  | "purchase-objections";

export type TopicSummary = {
  category: TopicCategory;
  count: number;
  samples: string[];
};

export type ConversationInsights = {
  messages: ConversationMessage[];
  topics: TopicSummary[];
  unanswered: ConversationMessage[];
  productRequests: { product: string; count: number }[];
  sessionCount: number;
  dateRange: { start: string | null; end: string | null };
  totalMessages: number;
};

const MAX_MESSAGES = 400;
const MAX_SAMPLES_PER_TOPIC = 3;

const PRODUCT_KEYWORDS = [
  "makhana", "fox nut", "foxnut", "meva", "dry fruit", "almond", "badam",
  "cashew", "kaju", "pistachio", "pista", "walnut", "akhrot", "dates", "khajur",
  "fig", "anjeer", "apricot", "khubani", "raisin", "kishmish", "prune",
  "मखाना", "मखाने", "मेवा", "मेवे", "बादाम", "काजू", "पिस्ता", "अखरोट",
  "खजूर", "अंजीर", "खुबानी", "किशमिश",
];

const COMPLAINT_KEYWORDS = [
  "complaint", "problem", "issue", "not working", "broken", "damaged",
  "leak", "spill", "expired", "bad quality", "poor quality", "stale",
  "delivery delay", "late", "missing", "wrong item", "refund", "return",
  "शिकायत", "समस्या", "दिक्कत", "खराब", "टूटा", "देरी", "गलत", "वापसी",
];

const OBJECTION_KEYWORDS = [
  "expensive", "too costly", "costly", "not worth", "waste of money",
  "cheaper", "discount", "offer", "promo", "mahanga", "mehnga",
  "महंगा", "महंगी", "छूट", "डिस्काउंट",
];

const REQUEST_KEYWORDS = [
  "do you have", "can i get", "available", "in stock", "out of stock",
  "order", "buy", "purchase", "shipping", "deliver",
  "उपलब्ध", "स्टॉक", "ऑर्डर", "खरीद", "डिलीवरी",
];

const QUESTION_KEYWORDS = [
  "price", "cost", "how much", "size", "variant", "difference",
  "what is", "tell me about", "explain", "kitna", "kya",
  "कीमत", "दाम", "कितना", "क्या", "साइज़", "अंतर",
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function classifyTopic(messageText: string): TopicCategory | null {
  const lower = messageText.toLowerCase();
  if (includesAny(lower, COMPLAINT_KEYWORDS)) return "complaints";
  if (includesAny(lower, OBJECTION_KEYWORDS)) return "purchase-objections";
  if (includesAny(lower, PRODUCT_KEYWORDS)) return "frequent-products";
  if (includesAny(lower, REQUEST_KEYWORDS)) return "product-requests";
  if (includesAny(lower, QUESTION_KEYWORDS)) return "common-questions";
  return null;
}

/**
 * Resolve a natural-language date range into ISO timestamps.
 * Returns null bounds when the question carries no recognisable range.
 */
export function parseDateRange(question: string, now = new Date()): { start: string | null; end: string | null } {
  const lower = question.toLowerCase();
  const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };
  const daysAgo = (days: number) => {
    const copy = new Date(now);
    copy.setDate(copy.getDate() - days);
    return copy;
  };

  if (/\btoday\b|आज/.test(lower)) {
    return { start: startOfDay(now).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\byesterday\b|कल\b/.test(lower)) {
    const yesterday = daysAgo(1);
    return { start: startOfDay(yesterday).toISOString(), end: endOfDay(yesterday).toISOString() };
  }
  if (/\bthis week\b|इस हफ्ते|इस सप्ताह/.test(lower)) {
    return { start: startOfDay(daysAgo(7)).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\bthis month\b|इस महीने/.test(lower)) {
    return { start: startOfDay(daysAgo(30)).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\blast month\b|पिछले महीने/.test(lower)) {
    return { start: startOfDay(daysAgo(60)).toISOString(), end: endOfDay(daysAgo(30)).toISOString() };
  }
  if (/\blast 7 days\b|\bpast week\b|पिछले 7 दिन/.test(lower)) {
    return { start: startOfDay(daysAgo(7)).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\blast 30 days\b|\bpast month\b|पिछले 30 दिन/.test(lower)) {
    return { start: startOfDay(daysAgo(30)).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\blast 90 days\b|\blast quarter\b|पिछले 90 दिन/.test(lower)) {
    return { start: startOfDay(daysAgo(90)).toISOString(), end: endOfDay(now).toISOString() };
  }
  if (/\ball time\b|\beverything\b|\bever\b|अब तक|सभी/.test(lower)) {
    return { start: null, end: null };
  }
  // Default: last 30 days keeps answers relevant and bounded.
  return { start: startOfDay(daysAgo(30)).toISOString(), end: endOfDay(now).toISOString() };
}

export async function getConversationInsights(
  supabase: SupabaseClient,
  merchantSlug: string,
  range: { start: string | null; end: string | null },
): Promise<ConversationInsights> {
  let query = supabase
    .from("customer_messages")
    .select("session_id,sender,message_text,status,created_at")
    .eq("merchant_slug", merchantSlug);

  if (range.start) query = query.gte("created_at", range.start);
  if (range.end) query = query.lte("created_at", range.end);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (error) throw new Error("Customer conversation query failed.");

  const messages = (data ?? []) as ConversationMessage[];
  const customerMessages = messages.filter((message) => message.sender === "customer");

  const categories: TopicCategory[] = [
    "frequent-products",
    "common-questions",
    "complaints",
    "unanswered",
    "product-requests",
    "purchase-objections",
  ];

  const topics: TopicSummary[] = categories
    .map((category) => {
      const matching = customerMessages.filter((message) => classifyTopic(message.message_text) === category);
      return {
        category,
        count: matching.length,
        samples: matching.slice(0, MAX_SAMPLES_PER_TOPIC).map((message) => message.message_text.slice(0, 300)),
      };
    })
    .filter((topic) => topic.count > 0)
    .sort((a, b) => b.count - a.count);

  // A customer question is "unanswered" when its session has no assistant reply after it.
  const assistantBySession = new Map<string, string[]>();
  for (const message of messages) {
    if (message.sender !== "assistant") continue;
    const list = assistantBySession.get(message.session_id) ?? [];
    list.push(message.created_at);
    assistantBySession.set(message.session_id, list);
  }
  const unanswered = customerMessages
    .filter((message) => {
      if (!message.message_text.trim().endsWith("?")) return false;
      const replies = assistantBySession.get(message.session_id) ?? [];
      return !replies.some((createdAt) => createdAt > message.created_at);
    })
    .slice(0, 20);

  const productCounts = new Map<string, number>();
  for (const message of customerMessages) {
    const lower = message.message_text.toLowerCase();
    for (const keyword of PRODUCT_KEYWORDS) {
      if (lower.includes(keyword)) {
        productCounts.set(keyword, (productCounts.get(keyword) ?? 0) + 1);
      }
    }
  }
  const productRequests = Array.from(productCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([product, count]) => ({ product, count }));

  return {
    messages,
    topics,
    unanswered,
    productRequests,
    sessionCount: new Set(messages.map((message) => message.session_id)).size,
    dateRange: range,
    totalMessages: messages.length,
  };
}
