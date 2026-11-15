import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerMessageSender = "customer" | "assistant";
export type CustomerMessageStatus = "sent" | "completed" | "failed" | "interrupted";

export type CustomerMessageMetadata = {
  provider?: string;
  model?: string;
  duration_ms?: number;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

export function isValidCustomerSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function getCustomerMerchantSlug(): string {
  return process.env.CUSTOMER_MERCHANT_SLUG || "shahi-meva";
}

// Best-effort logging: a database failure must never break the chatbot.
// The caller supplies the existing server-side Supabase client.
export async function insertCustomerMessage(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    sender: CustomerMessageSender;
    messageText: string;
    status: CustomerMessageStatus;
    metadata?: CustomerMessageMetadata;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("customer_messages").insert({
      merchant_slug: getCustomerMerchantSlug(),
      session_id: input.sessionId,
      sender: input.sender,
      message_text: input.messageText,
      status: input.status,
      metadata: input.metadata ?? {},
    });
    if (error) {
      console.error("[customer-logging] insert failed", { code: error.code, message: error.message });
    }
  } catch (error) {
    console.error("[customer-logging] insert failed", error instanceof Error ? error.message : error);
  }
}
