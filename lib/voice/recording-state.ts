export type CaptureState = "idle" | "requesting" | "recording" | "paused" | "transcribing";

export type CaptureEvent =
  | "REQUEST_PERMISSION"
  | "PERMISSION_GRANTED"
  | "PERMISSION_FAILED"
  | "PAUSE"
  | "SILENCE_DETECTED"
  | "MAX_DURATION_REACHED"
  | "RESUME"
  | "TRANSCRIBE"
  | "TRANSCRIPTION_FAILED"
  | "TRANSCRIPTION_SUCCEEDED"
  | "DISCARD";

export const MAX_RECORDING_DURATION_MS = 60_000;
export const SILENCE_PAUSE_DURATION_MS = 5_000;

export function formatRecordingCountdown(remainingSeconds: number): string {
  const seconds = Number.isFinite(remainingSeconds) ? Math.max(0, Math.floor(remainingSeconds)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function transitionCaptureState(state: CaptureState, event: CaptureEvent): CaptureState {
  if (event === "DISCARD") return "idle";
  if (state === "idle" && event === "REQUEST_PERMISSION") return "requesting";
  if (state === "requesting" && event === "PERMISSION_GRANTED") return "recording";
  if (state === "requesting" && event === "PERMISSION_FAILED") return "idle";
  if (state === "recording" && ["PAUSE", "SILENCE_DETECTED", "MAX_DURATION_REACHED"].includes(event)) return "paused";
  if (state === "paused" && event === "RESUME") return "recording";
  if (state === "paused" && event === "TRANSCRIBE") return "transcribing";
  if (state === "transcribing" && event === "TRANSCRIPTION_SUCCEEDED") return "idle";
  if (state === "transcribing" && event === "TRANSCRIPTION_FAILED") return "paused";
  return state;
}

export function shouldPauseForSilence(silentDurationMs: number): boolean {
  return Number.isFinite(silentDurationMs) && silentDurationMs >= SILENCE_PAUSE_DURATION_MS;
}

export function shouldPauseAtMaximumDuration(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= MAX_RECORDING_DURATION_MS;
}
