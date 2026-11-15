import { randomUUID } from "node:crypto";
import { transcribeGeminiAudio } from "@/lib/ask/providers/gemini";
import { getWebmDurationMs } from "@/lib/voice/webm-duration";
import { validateWebmAudioUpload } from "@/lib/voice/validation";
import { createProviderOperationalFailure } from "@/lib/ask/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 10_500_000;

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3002",
  "https://shahimeva.vercel.app",
  "http://localhost:8000",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function safeErrorCategory(error: unknown): string {
  if (error && typeof error === "object" && "failureType" in error && typeof error.failureType === "string") {
    return error.failureType;
  }
  return "transcription_error";
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");

  if (!corsHeaders(origin)["Access-Control-Allow-Origin"]) {
    return json({ error: "Request origin is not allowed." }, 403, origin);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "Send a WebM audio recording." }, 415, origin);
  }

  const requestId = randomUUID();
  const body = await readBoundedBody(request);
  if (!body) return json({ error: "The audio upload is too large." }, 413, origin);

  let audioFile: File;
  try {
    const form = await new Request(request.url, { method: "POST", headers: request.headers, body: body as unknown as BodyInit }).formData();
    const value = form.get("audio");
    if (!(value instanceof File)) return json({ error: "Choose a recording to transcribe." }, 400, origin);
    audioFile = value;
  } catch {
    return json({ error: "The audio upload could not be read." }, 400, origin);
  }

  const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
  const durationMs = getWebmDurationMs(audioBytes);
  const validation = validateWebmAudioUpload({ mimeType: audioFile.type, size: audioFile.size, durationMs });
  if (!validation.valid) return json({ error: validation.message }, validation.status, origin);

  const model = "gemini-3.5-transcribe";
  const recordProviderFailure = (error: unknown) => {
    let diagnosticDetails: { status?: number; body?: string } | undefined;
    if (error && typeof error === "object" && "diagnosticDetails" in error) {
      const rawDiagnosticDetails = error.diagnosticDetails;
      if (rawDiagnosticDetails && typeof rawDiagnosticDetails === "object") {
        diagnosticDetails = {
          ...("status" in rawDiagnosticDetails && typeof rawDiagnosticDetails.status === "number"
            ? { status: rawDiagnosticDetails.status }
            : {}),
          ...("body" in rawDiagnosticDetails && typeof rawDiagnosticDetails.body === "string"
            ? { body: rawDiagnosticDetails.body }
            : {}),
        };
      }
    }
    console.error("[customer-voice] provider_failure", {
      requestId,
      provider: "gemini",
      model,
      failureType: safeErrorCategory(error),
      ...(diagnosticDetails ? { providerResponse: diagnosticDetails } : {}),
    });
  };

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw createProviderOperationalFailure("not_configured");
    const result = await transcribeGeminiAudio({
      apiKey,
      model,
      mimeType: "audio/webm",
      audioBase64: Buffer.from(audioBytes).toString("base64"),
    });
    return json({ transcript: result.text }, 200, origin);
  } catch (error) {
    recordProviderFailure(error);
  }

  return json({ error: "Couldn't process that. Please try again." }, 502, origin);
}
