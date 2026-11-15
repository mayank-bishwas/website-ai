import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseAssistantMarkdown } from "../lib/ask/format.ts";
import { readAskEventStream } from "../lib/ask/client-stream.ts";
import { shouldAutoScrollToLatest } from "../lib/ask/scroll.ts";
import { buildAskDebugEntry, estimateAttemptCost, isDiagnosticsEnabled, parseModelPricing } from "../lib/ask/diagnostics.ts";
import { requestGemini, transcribeGeminiAudio } from "../lib/ask/providers/gemini.ts";
import { createProviderOperationalFailure } from "../lib/ask/types.ts";
import { formatRecordingCountdown, MAX_RECORDING_DURATION_MS, shouldPauseAtMaximumDuration, shouldPauseForSilence, SILENCE_PAUSE_DURATION_MS, transitionCaptureState } from "../lib/voice/recording-state.ts";
import { getWebmDurationMs } from "../lib/voice/webm-duration.ts";
import { validateWebmAudioUpload } from "../lib/voice/validation.ts";
import { countKnowledgeWords, insertKnowledgeTranscript } from "../lib/portal-knowledge.ts";
import { getContactWhatsappUrl } from "../lib/portal-i18n.ts";

function vintSize(size) {
  assert.ok(size < 127);
  return Uint8Array.of(0x80 | size);
}
function element(id, payload) {
  const idBytes = Uint8Array.from(id.match(/../g), (byte) => Number.parseInt(byte, 16));
  const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  return Uint8Array.from([...idBytes, ...vintSize(body.length), ...body]);
}
function concat(...arrays) {
  return Uint8Array.from(arrays.flatMap((item) => [...item]));
}
function testWebm(lastTimestamp) {
  const ebmlHeader = element("1a45dfa3", element("4286", [1]));
  const timestamp = element("e7", [0]);
  const blockAt = (time) => element("a3", [0x81, (time >> 8) & 255, time & 255, 0x80, 0]);
  const cluster = element("1f43b675", concat(timestamp, blockAt(0), blockAt(lastTimestamp)));
  const track = element("ae", concat(element("d7", [1]), element("83", [2]), element("86", new TextEncoder().encode("A_OPUS"))));
  const tracks = element("1654ae6b", track);
  const segment = element("18538067", concat(tracks, cluster));
  return concat(ebmlHeader, segment);
}

test("assistant Markdown formats tables, lists, direct lines, paragraphs, and Hindi Unicode as blocks", () => {
  const blocks = parseAssistantMarkdown("| Product | Price |\n| --- | ---: |\n| Kaju | ₹550 |\n\n- Badam\n- Pista\n\nहाँ, 500 g pack उपलब्ध है.");
  assert.deepEqual(blocks, [
    { type: "table", rows: [["Product", "Price"], ["Kaju", "₹550"]] },
    { type: "list", items: ["Badam", "Pista"] },
    { type: "paragraph", text: "हाँ, 500 g pack उपलब्ध है." },
  ]);
  assert.deepEqual(parseAssistantMarkdown("Kaju 500 g is ₹550."), [{ type: "paragraph", text: "Kaju 500 g is ₹550." }]);
});

test("conversation scroll follows new messages only when near-bottom or a new user message was sent", () => {
  assert.equal(shouldAutoScrollToLatest(true, false), true);
  assert.equal(shouldAutoScrollToLatest(false, false), false);
  assert.equal(shouldAutoScrollToLatest(false, true), true);
});

test("developer pricing uses exact provider/model configuration, separate cached prices, and no guessed defaults", () => {
  const pricing = parseModelPricing(JSON.stringify({
    "gemini/gemini-2.5-flash": { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, cachedInputUsdPerMillionTokens: 0.25 },
    "openrouter/deepseek/test": { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 1 },
  }));
  assert.equal(estimateAttemptCost("gemini", "gemini-2.5-flash", { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 }, pricing), 0.00011);
  assert.equal(estimateAttemptCost("gemini", "unknown", { inputTokens: 100, outputTokens: 20 }, pricing), undefined);
  assert.deepEqual(parseModelPricing("not json"), {});
});

test("diagnostics report Gemini usage, fallback attempts, missing counts, cost source, and no conversation text", () => {
  const entry = buildAskDebugEntry({
    requestId: "request-1",
    responseTimeMs: 420,
    attempts: [
      { provider: "gemini", model: "gemini-2.5-flash", durationMs: 100, succeeded: false, fallbackOccurred: false, failureType: "http_503" },
      { provider: "openrouter", model: "deepseek/test", durationMs: 320, succeeded: true, fallbackOccurred: true, usage: { inputTokens: 30, outputTokens: 8, totalTokens: 38, cachedInputTokens: 5 }, actualCostUsd: 0.00002 },
    ],
    sources: [{ source: "ga4", called: true, status: "empty", durationMs: 70 }],
    pricingMap: parseModelPricing(JSON.stringify({ "openrouter/deepseek/test": { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 } })),
  });
  assert.equal(entry.providerUsed, "openrouter");
  assert.equal(entry.model, "deepseek/test");
  assert.equal(entry.inputTokens, 30);
  assert.equal(entry.outputTokens, 8);
  assert.equal(entry.totalTokens, 38);
  assert.equal(entry.fallbackUsed, true);
  assert.equal(entry.fallbackAttempted, true);
  assert.equal(entry.primaryFailureCategory, "http_503");
  assert.equal(entry.attempts[0].usage, undefined);
  assert.equal(entry.attempts[0].estimatedCostUsd, undefined);
  assert.equal(entry.attempts[1].actualCostUsd, 0.00002);
  assert.ok(entry.attempts[1].estimatedCostUsd !== undefined);
  assert.deepEqual(entry.sources[0], { source: "ga4", called: true, status: "empty", durationMs: 70 });
  assert.equal(JSON.stringify(entry).includes("question text"), false);
  const missing = buildAskDebugEntry({ requestId: "request-2", responseTimeMs: 5, attempts: [{ provider: "gemini", model: "m", durationMs: 5, succeeded: true, fallbackOccurred: false }] });
  assert.equal(missing.inputTokens, undefined);
  assert.equal(missing.attempts[0].actualCostUsd, undefined);
  assert.equal(isDiagnosticsEnabled("development"), true);
  assert.equal(isDiagnosticsEnabled("production"), false);
});

test("Gemini diagnostics read usageMetadata without estimating tokens", async () => {
  const response = await requestGemini({ apiKey: "key", model: "gemini-2.5-flash", systemInstruction: "system", prompt: "prompt" }, async () => Response.json({
    candidates: [{ content: { parts: [{ text: "answer" }] } }],
    usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 4, totalTokenCount: 21, cachedContentTokenCount: 3 },
  }));
  assert.deepEqual(response.usage, { inputTokens: 17, outputTokens: 4, totalTokens: 21, cachedInputTokens: 3 });
});

test("voice state supports paused send, resume, discard, silence, and duration limit", () => {
  let state = transitionCaptureState("idle", "REQUEST_PERMISSION");
  state = transitionCaptureState(state, "PERMISSION_GRANTED");
  assert.equal(state, "recording");
  assert.equal(shouldPauseForSilence(SILENCE_PAUSE_DURATION_MS - 1), false);
  assert.equal(shouldPauseForSilence(SILENCE_PAUSE_DURATION_MS), true);
  state = transitionCaptureState(state, "SILENCE_DETECTED");
  assert.equal(state, "paused");
  state = transitionCaptureState(state, "RESUME");
  assert.equal(state, "recording");
  state = transitionCaptureState(state, "MAX_DURATION_REACHED");
  assert.equal(state, "paused");
  assert.equal(shouldPauseAtMaximumDuration(MAX_RECORDING_DURATION_MS), true);
  state = transitionCaptureState(state, "TRANSCRIBE");
  assert.equal(state, "transcribing");
  state = transitionCaptureState(state, "TRANSCRIPTION_SUCCEEDED");
  assert.equal(state, "idle");
  assert.equal(transitionCaptureState("paused", "DISCARD"), "idle");
  assert.equal(transitionCaptureState(transitionCaptureState("paused", "TRANSCRIBE"), "TRANSCRIPTION_FAILED"), "paused");
});

test("ASK stream parser delivers chunks and assistant-stop completion events in order", async () => {
  const chunks = [
    'data: {"type":"token","token":"Half ',
    'answer"}\n\ndata: {"type":"reset"}\n\ndata: {"type":"token","token":"Complete.',
    '"}\n\ndata: {"type":"done","contactOffered":false}\n\n',
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  const events = [];
  await readAskEventStream(new Response(body), (event) => events.push(event));
  assert.deepEqual(events, [
    { type: "token", token: "Half answer" },
    { type: "reset" },
    { type: "token", token: "Complete." },
    { type: "done", contactOffered: false },
  ]);
});

test("Knowledge Base word limits count multilingual text without truncating it", () => {
  assert.equal(countKnowledgeWords("Write five words in this sentence."), 6);
  assert.equal(countKnowledgeWords("यह एक हिंदी परीक्षण है।"), 5);
  assert.equal(countKnowledgeWords("La tienda abre todos los días."), 6);
  assert.equal(countKnowledgeWords(""), 0);
});

test("Knowledge Base voice transcripts insert at the cursor without replacing existing content", () => {
  const beginning = insertKnowledgeTranscript("Keep this sentence.", "New words.", 0);
  assert.equal(beginning.content, "New words. Keep this sentence.");
  assert.equal(beginning.content.slice(beginning.cursor), "Keep this sentence.");

  const middle = insertKnowledgeTranscript("Keep this sentence.", "New words.", 5);
  assert.equal(middle.content, "Keep New words. this sentence.");

  const end = insertKnowledgeTranscript("Keep this sentence.", "New words.", 999);
  assert.equal(end.content, "Keep this sentence. New words.");
  assert.equal(countKnowledgeWords(end.content), 5);
});

test("Knowledge Base voice controls stay inside the editor without separate recording actions", async () => {
  const portal = await readFile(new URL("../components/MerchantPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /className="portal-kb-transcribing-dots" role="status"/);
  assert.match(portal, /aria-busy=\{voice\.state === "transcribing"\}/);
  assert.match(portal, /resetAfterTranscription: true,\s*resetOnFailure: true/);
  assert.doesNotMatch(portal, /portal-voice-actions|portal-voice-status/);
});

test("WebM duration derives from media block timestamps and enforces the 60-second limit", () => {
  assert.equal(MAX_RECORDING_DURATION_MS, 60_000);
  assert.equal(formatRecordingCountdown(60), "01:00");
  assert.equal(formatRecordingCountdown(59), "00:59");
  assert.equal(formatRecordingCountdown(0), "00:00");
  assert.equal(getWebmDurationMs(testWebm(29_900)), 29_900);
  assert.equal(getWebmDurationMs(testWebm(30_500)), 30_500);
  assert.equal(getWebmDurationMs(Uint8Array.of(1, 2, 3)), null);
  assert.deepEqual(validateWebmAudioUpload({ mimeType: "audio/webm;codecs=opus", size: 100, durationMs: 20_000 }), { valid: true });
  assert.deepEqual(validateWebmAudioUpload({ mimeType: "audio/webm", size: 100, durationMs: 60_000 }), { valid: true });
  assert.equal(validateWebmAudioUpload({ mimeType: "audio/mp3", size: 100, durationMs: 1_000 }).status, 415);
  assert.equal(validateWebmAudioUpload({ mimeType: "audio/webm", size: 7_500_001, durationMs: 1_000 }).status, 413);
  assert.equal(validateWebmAudioUpload({ mimeType: "audio/webm", size: 100, durationMs: null }).status, 400);
  assert.equal(validateWebmAudioUpload({ mimeType: "audio/webm", size: 100, durationMs: 60_001 }).status, 413);
});

test("WebM duration validation counts laced Opus packets instead of trusting container duration metadata", () => {
  const ebmlHeader = element("1a45dfa3", element("4286", [1]));
  const track = element("ae", concat(element("d7", [1]), element("83", [2]), element("86", new TextEncoder().encode("A_OPUS"))));
  const tracks = element("1654ae6b", track);
  const timestamp = element("e7", [0]);
  const lacedBlock = element("a3", [0x81, 0, 0, 0x82, 1, 1, 0, 0]);
  const cluster = element("1f43b675", concat(timestamp, lacedBlock));
  const webm = concat(ebmlHeader, element("18538067", concat(tracks, cluster)));
  assert.equal(getWebmDurationMs(webm), 20);
});

test("Gemini transcription reads its dedicated transcript field and provider usage", async () => {
  let request;
  const result = await transcribeGeminiAudio({ apiKey: "server-key", model: "gemini-3.5-transcribe", mimeType: "audio/webm", audioBase64: "AA==" }, async (url, options) => {
    request = { url, options };
    return Response.json({ candidates: [{ content: { parts: [{ audioTranscription: { text: "  नमस्ते  " } }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11 } });
  });
  assert.match(request.url, /generativelanguage.googleapis.com/);
  assert.match(request.url, /models\/gemini-3\.5-transcribe:generateContent$/);
  assert.equal(request.options.headers["x-goog-api-key"], "server-key");
  assert.match(request.options.body, /preserving the language used by the speaker/);
  assert.deepEqual(result, { text: "नमस्ते", usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 } });
  assert.doesNotMatch(request.options.body, /server-key/);
  await assert.rejects(transcribeGeminiAudio({ apiKey: "", model: "m", mimeType: "audio/webm", audioBase64: "AA==" }, async () => { throw new Error("must not call"); }), /Provider request failed/);
});

test("Gemini transcription preserves the provider response for server diagnostics", async () => {
  const result = await transcribeGeminiAudio(
    { apiKey: "server-key", model: "gemini-2.5-flash", mimeType: "audio/webm", audioBase64: "AA==" },
    async () => new Response(JSON.stringify({ error: { code: 404, message: "Model unavailable: server-key" } }), { status: 404 }),
  ).catch((error) => error);

  assert.equal(result.failureType, "http_404");
  assert.equal(result.diagnosticDetails.status, 404);
  assert.match(result.diagnosticDetails.body, /Model unavailable/);
  assert.doesNotMatch(result.diagnosticDetails.body, /server-key/);
});

test("voice UI is bilingual, uses friendly messages, and displays only the remaining countdown", async () => {
  const localization = await readFile(new URL("../lib/portal-i18n.ts", import.meta.url), "utf8");
  const askComposer = await readFile(new URL("../components/AskComposer.tsx", import.meta.url), "utf8");
  const portal = await readFile(new URL("../components/MerchantPortal.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(localization, /आज मैं आपकी क्या मदद कर सकता हूँ/);
  assert.match(localization, /placeholder: "उत्पादों, कीमतों/);
  assert.match(localization, /Listening…/);
  assert.match(localization, /सुन रहे हैं…/);
  assert.doesNotMatch(localization, /Gemini|DeepSeek|Supabase|database|transcription service/i);
  assert.match(page, /askLabels\.suggestions\.map/);
  assert.match(askComposer, /askPlaceholder=\{ask\.placeholder\}/);
  assert.match(askComposer, /askInputLabel=\{ask\.inputLabel\}/);
  assert.doesNotMatch(page, /Gemini|DeepSeek|Supabase|database|Transcription API/i);
  assert.doesNotMatch(askComposer, /timer} \/ 01:00/);
  assert.doesNotMatch(portal, /secondsRemaining\)\} \/ 01:00/);
  assert.match(css, /\.composer textarea:focus-visible\s*\{[^}]*box-shadow:\s*none/s);
});

test("ASK voice send uses normal disabled composer, right-aligned transcript dots, and upstream answer cancellation", async () => {
  const composer = await readFile(new URL("../components/AskComposer.tsx", import.meta.url), "utf8");
  const commonComposer = await readFile(new URL("../components/Composer.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/ask/route.ts", import.meta.url), "utf8");
  const gemini = await readFile(new URL("../lib/ask/providers/gemini.ts", import.meta.url), "utf8");
  const openrouter = await readFile(new URL("../lib/ask/providers/openrouter.ts", import.meta.url), "utf8");
  assert.match(composer, /resetAfterTranscription: true/);
  assert.match(composer, /resetOnFailure: true/);
  assert.match(composer, /disabled=\{disabled \|\| voice\.state === "transcribing"\}/);
  assert.match(composer, /<Icon name="pause"/);
  assert.match(page, /className="thinking-row thinking-row-user"/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /filter\(\(message\) => message\.content\.trim\(\)\)/);
  assert.match(page, /active\.content/);
  assert.match(route, /signal,/);
  assert.match(route, /onToken: \(token\)/);
  assert.match(gemini, /signal: options\.signal/);
  assert.match(openrouter, /signal: options\.signal/);
  assert.match(commonComposer, /showStopResponse && onStopResponse/);
});

test("ASK footer is centered in both languages and WhatsApp uses the support number and message language", async () => {
  const localization = await readFile(new URL("../lib/portal-i18n.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const english = new URL(getContactWhatsappUrl("I need help with the assistant."));
  const hindi = new URL(getContactWhatsappUrl("मुझे सहायक से मदद चाहिए।"));
  assert.equal(english.hostname, "wa.me");
  assert.equal(english.pathname, "/918521567359");
  assert.match(english.searchParams.get("text") ?? "", /iSellOnline/);
  assert.equal(hindi.pathname, "/918521567359");
  assert.match(hindi.searchParams.get("text") ?? "", /मदद|समस्या/);
  assert.match(localization, /askCaption: "Answers are based on information published by Shahi Meva\."/);
  assert.match(localization, /askCaption: "जवाब शाही मेवा के प्रकाशित जानकारी पर आधारित है।"/);
  assert.match(page, /composer-caption\$\{mode === "ASK" \? " ask-caption" : ""\}/);
  assert.match(css, /\.composer-caption\.ask-caption\s*\{[^}]*justify-content:\s*center[^}]*text-align:\s*center/s);
});

test("Edit Mode password modal uses only localized requested copy", async () => {
  const localization = await readFile(new URL("../lib/portal-i18n.ts", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../components/PasswordDialog.tsx", import.meta.url), "utf8");
  assert.match(localization, /title: "Enter password to access Edit Mode"/);
  assert.match(localization, /title: "एडिट मोड में प्रवेश करने के लिए पासवर्ड दर्ज करें"/);
  assert.match(localization, /placeholder: "Enter password"/);
  assert.match(localization, /placeholder: "पासवर्ड दर्ज करें"/);
  assert.match(localization, /continue: "Enter"/);
  assert.match(localization, /continue: "प्रवेश करें"/);
  assert.match(localization, /error: "That password doesn't match\. Try again\."/);
  assert.match(localization, /error: "पासवर्ड सही नहीं है। कृपया फिर कोशिश करें।"/);
  assert.doesNotMatch(dialog, /text\.(?:eyebrow|description|label|close)|mock-note|dialog-close/);
  assert.match(dialog, /onSubmit=\{submit\}/);
  assert.match(dialog, /type=\{visible \? "text" : "password"\}/);
  assert.match(dialog, /text\.show/);
  assert.match(dialog, /text\.hide/);
});

test("conversation layout keeps a scrollable thread and persistent composer without hydration suppression", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /\.conversation-scroll\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.composer-dock\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.doesNotMatch(layout, /suppressHydrationWarning/);
});


test("voice route uses dedicated transcription and returns no provider diagnostics to the client", async () => {
  const route = await readFile(new URL("../app/api/ask/transcribe/route.ts", import.meta.url), "utf8");
  const recorder = await readFile(new URL("../components/AskComposer.tsx", import.meta.url), "utf8");
  const voice = await readFile(new URL("../lib/voice/use-voice-transcription.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(route, /isAskLocalAccessAllowed/);
  assert.match(route, /transcribeGeminiAudio/);
  assert.match(route, /"gemini-3\.5-transcribe"/);
  assert.doesNotMatch(route, /transcribeOpenRouterAudio|OPENROUTER_API_KEY/);
  assert.match(route, /providerResponse/);
  assert.match(route, /Couldn't process that\. Please try again\./);
  assert.doesNotMatch(route, /Gemini could not transcribe|Whisper|DeepSeek/);
  assert.doesNotMatch(route, /buildAskDebugEntry|isDiagnosticsEnabled|diagnostics:/);
  assert.doesNotMatch(page, /AskDebugPanel|debugEntries|payload\.diagnostics/);
  assert.doesNotMatch(voice, /AskDebugEntry|onDiagnostics|payload\.diagnostics/);
  assert.doesNotMatch(recorder, /AskDebugEntry|onDiagnostics/);
  assert.doesNotMatch(route, /createSupabaseServerClient|writeFile|console\.(?:log|info)/);
  assert.doesNotMatch(voice, /localStorage|sessionStorage|indexedDB|sendBeacon/);
  assert.match(voice, /MAX_RECORDING_DURATION_MS/);
  assert.match(recorder, /voice\.send\(submitVoiceTranscript, onTranscriptionChange/);
  assert.match(recorder, /text\.sendRecording/);
  assert.match(recorder, /text\.discard/);
  assert.doesNotMatch(recorder, /submitAsk|onConfirmTranscript/);
});

test("ASK personality instruction is warm, peppy and witty with Hindi/Hinglish support", async () => {
  const prompt = await readFile(new URL("../lib/ask/prompt.ts", import.meta.url), "utf8");
  const answer = await readFile(new URL("../lib/ask/answer.ts", import.meta.url), "utf8");
  assert.match(prompt, /warm, peppy and witty/);
  assert.match(prompt, /Hindi.*Hinglish/);
  assert.match(prompt, /self-deprecating/);
  assert.match(answer, /source: "knowledge-base"/);
  assert.match(answer, /getKnowledge/);
});

test("ASK page keeps messages in memory and clears them when returning from EDIT", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/ask/route.ts", import.meta.url), "utf8");
  assert.match(page, /setAskMessages\(\[\]\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(route, /insertConversationMessage|createConversation|sessionStorage/);
});
