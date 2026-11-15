export const MAX_AUDIO_UPLOAD_BYTES = 7_500_000;
export const MAX_VERIFIED_AUDIO_DURATION_MS = 60_000;
const WEBM_AUDIO_TYPE = /^audio\/webm(?:\s*;\s*codecs=opus)?$/i;

export type AudioValidationResult = { valid: true } | { valid: false; status: 400 | 413 | 415; message: string };

export function validateWebmAudioUpload(input: { mimeType: string; size: number; durationMs: number | null }): AudioValidationResult {
  if (!WEBM_AUDIO_TYPE.test(input.mimeType) || input.size < 1) {
    return { valid: false, status: 415, message: "This audio format is not supported. Record audio in WebM and try again." };
  }
  if (input.size > MAX_AUDIO_UPLOAD_BYTES) {
    return { valid: false, status: 413, message: "The recording exceeds the 7.5 MB limit." };
  }
  if (input.durationMs === null || !Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    return { valid: false, status: 400, message: "The WebM recording is invalid or its duration could not be verified." };
  }
  if (input.durationMs > MAX_VERIFIED_AUDIO_DURATION_MS) {
    return { valid: false, status: 413, message: "Recordings must be 60 seconds or shorter." };
  }
  return { valid: true };
}
