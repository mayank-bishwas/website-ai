import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countKnowledgeWords } from "@/lib/portal-knowledge";
import { isAllowedLocalAskOrigin, isAskLocalAccessAllowed } from "@/lib/ask/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isAllowedRequest(request: Request): boolean {
  try {
    return (
      isAskLocalAccessAllowed({
        nodeEnv: process.env.NODE_ENV,
        vercel: process.env.VERCEL,
        hostname: new URL(request.url).hostname,
      }) &&
      isAllowedLocalAskOrigin({
        origin: request.headers.get("origin"),
        requestUrl: request.url,
        hostHeader: request.headers.get("host"),
      })
    );
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<unknown | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "The request is too large." }, 413);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Send the Knowledge Base change as JSON." }, 415);
  }
  try {
    return await request.json();
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validContent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= MAX_BODY_BYTES &&
    countKnowledgeWords(value) <= 500
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isAllowedRequest(request)) return json({ error: "Knowledge Base is available only in local development." }, 404);
  try {
    const { data, error } = await createSupabaseServerClient()
      .from("knowledge_entries")
      .select("id,updated_at,content,status")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.error("[knowledge] load_failed", error.message);
      return json({ error: "Knowledge Base entries could not be loaded." }, 503);
    }
    return json({ entries: data ?? [] });
  } catch (error) {
    console.error("[knowledge] load_failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Knowledge Base entries could not be loaded." }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedRequest(request)) return json({ error: "Knowledge Base is available only in local development." }, 404);
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (!isObject(body) || !validContent(body.content)) {
    return json({ error: "Enter Knowledge Base content of up to 500 words." }, 400);
  }

  try {
    const { data, error } = await createSupabaseServerClient()
      .from("knowledge_entries")
      .insert({ content: body.content.trim(), status: "published" })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[knowledge] create_failed", error?.message ?? "No created record returned.");
      return json({ error: "The Knowledge Base entry could not be published." }, 400);
    }
    return json({ id: data.id }, 201);
  } catch (error) {
    console.error("[knowledge] create_failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The Knowledge Base entry could not be published." }, 400);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isAllowedRequest(request)) return json({ error: "Knowledge Base is available only in local development." }, 404);
  const body = await readJson(request);
  if (isResponse(body)) return body;
  if (!isObject(body) || typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return json({ error: "Choose a valid Knowledge Base entry." }, 400);
  }

  let update: { content?: string; status?: "published" | "archived" };
  if (body.action === "edit" && validContent(body.content)) {
    update = { content: body.content.trim() };
  } else if (body.action === "archive") {
    update = { status: "archived" };
  } else if (body.action === "restore") {
    update = { status: "published" };
  } else {
    return json({ error: "The Knowledge Base change is invalid." }, 400);
  }

  try {
    const { data, error } = await createSupabaseServerClient()
      .from("knowledge_entries")
      .update(update)
      .eq("id", body.id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[knowledge] update_failed", error.message);
      return json({ error: "The Knowledge Base entry could not be updated." }, 400);
    }
    if (!data) return json({ error: "This Knowledge Base entry no longer exists." }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error("[knowledge] update_failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The Knowledge Base entry could not be updated." }, 400);
  }
}
