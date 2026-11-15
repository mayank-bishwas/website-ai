import { randomUUID } from "node:crypto";
import { isAllowedLocalAskOrigin, isAskLocalAccessAllowed } from "@/lib/ask/access";
import { transcribeGeminiAudio } from "@/lib/ask/providers/gemini";
import { getWebmDurationMs } from "@/lib/voice/webm-duration";
import { validateWebmAudioUpload } from "@/lib/voice/validation";
import { createProviderOperationalFailure } from "@/lib/ask/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 10_500_000;

function localOnly(request: Request): boolean {
  try {
    return isAskLocalAccessAllowed({
      nodeEnv: process.env.NODE_ENV,
      vercel: process.env.VERCEL,
      hostname: new URL(request.url).hostname,
    });
  } catch {
    return false;
  }
}

function sameOrigin(request: Request): boolean {
  return isAllowedLocalAskOrigin({
    origin: request.headers.get("origin"),
    requestUrl: request.url,
    hostHeader: request.headers.get("host"),
  });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
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

export async function POST(request: Request): Promise<Response> {
  if (!localOnly(request)) return json({ error: "Voice transcription is enabled only for local development." }, 404);
  if (!sameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return json({ error: "Send a WebM audio recording." }, 415);
  }

  const requestId = randomUUID();
  const body = await readBoundedBody(request);
  if (!body) return json({ error: "The audio upload is too large." }, 413);

  let audioFile: File;
  try {
    const form = await new Request(request.url, { method: "POST", headers: request.headers, body: body as unknown as BodyInit }).formData();
    const value = form.get("audio");
    if (!(value instanceof File)) return json({ error: "Choose a recording to transcribe." }, 400);
    audioFile = value;
  } catch {
    return json({ error: "The audio upload could not be read." }, 400);
  }

  const audioBytes = new Uint8Array(await audioFile.arrayBuffer());
  const durationMs = getWebmDurationMs(audioBytes);
  const validation = validateWebmAudioUpload({ mimeType: audioFile.type, size: audioFile.size, durationMs });
  if (!validation.valid) return json({ error: validation.message }, validation.status);

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
    console.error("[voice] provider_failure", {
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
    return json({ transcript: result.text });
  } catch (error) {
    recordProviderFailure(error);
  }

  return json({ error: "Couldn't process that. Please try again." }, 502);
}
