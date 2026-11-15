import type { SupabaseClient } from "@supabase/supabase-js";
import type { AskMessage, ConversationTurn } from "./types";

type ConversationRow = { id: string; browser_token: string };

type MessageRow = {
  id: string;
  sender: "user" | "agent";
  message_text: string;
  status: "sent" | "processing" | "completed" | "failed";
};

export async function getOrCreateConversation(
  supabase: SupabaseClient,
  browserToken: string,
): Promise<ConversationRow> {
  const { data: existing, error: lookupError } = await supabase
    .from("conversations")
    .select("id,browser_token")
    .eq("browser_token", browserToken)
    .maybeSingle();

  if (lookupError) throw new Error("Conversation lookup failed.");
  if (existing) return existing as ConversationRow;

  const { data: created, error: insertError } = await supabase
    .from("conversations")
    .insert({ browser_token: browserToken })
    .select("id,browser_token")
    .single();

  if (!insertError && created) return created as ConversationRow;

  // Another tab can create the unique browser token between lookup and insert.
  if (insertError?.code === "23505") {
    const { data: concurrent, error } = await supabase
      .from("conversations")
      .select("id,browser_token")
      .eq("browser_token", browserToken)
      .maybeSingle();
    if (!error && concurrent) return concurrent as ConversationRow;
  }

  throw new Error("Conversation creation failed.");
}

export async function getConversationHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 12,
): Promise<ConversationTurn[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("sender,message_text,status")
    .eq("conversation_id", conversationId)
    .eq("mode", "ASK")
    .in("status", ["sent", "completed"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Conversation history could not be loaded.");
  return ((data ?? []) as MessageRow[]).reverse().map((message) => ({
    role: message.sender === "user" ? "user" : "assistant",
    content: message.message_text,
  }));
}

export async function listConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<AskMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,message_text,status")
    .eq("conversation_id", conversationId)
    .eq("mode", "ASK")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("Conversation messages could not be loaded.");
  return ((data ?? []) as MessageRow[]).reverse().map((message) => ({
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    content: message.message_text,
  }));
}

export async function insertConversationMessage(
  supabase: SupabaseClient,
  input: {
    conversationId: string;
    sender: "user" | "agent";
    content: string;
    status: "sent" | "completed" | "failed";
  },
): Promise<AskMessage> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender: input.sender,
      mode: "ASK",
      message_text: input.content,
      status: input.status,
    })
    .select("id,sender,message_text")
    .single();

  if (error || !data) throw new Error("Message persistence failed.");
  return {
    id: data.id,
    role: data.sender === "user" ? "user" : "assistant",
    content: data.message_text,
  };
}
