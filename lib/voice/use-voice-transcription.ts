"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Locale, voiceText } from "@/lib/portal-i18n";
import {
  MAX_RECORDING_DURATION_MS,
  transitionCaptureState,
  type CaptureState,
} from "@/lib/voice/recording-state";

const MAX_CAPTURE_SIZE = 7_500_000;
type VoiceMessageKey = keyof typeof voiceText.en;
type VoiceSendOptions = {
  resetAfterTranscription?: boolean;
  resetOnFailure?: boolean;
};

export function useVoiceTranscription(locale: Locale) {
  const [state, setState] = useState<CaptureState>("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [errorKey, setErrorKey] = useState<VoiceMessageKey | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioBlobRef = useRef<Blob | null>(null);
  const pendingTranscriptRef = useRef<string | null>(null);
  const countdownRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const permissionRequestRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const text = voiceText[locale];
  const error = errorKey ? text[errorKey] : "";
  const setError = useCallback((message: string) => {
    const key = (Object.keys(voiceText.en) as VoiceMessageKey[])
      .find((candidate) => voiceText.en[candidate] === message || voiceText.hi[candidate] === message);
    setErrorKey(key ?? null);
  }, []);

  const clearTimers = useCallback(() => {
    if (countdownRef.current !== null) window.clearInterval(countdownRef.current);
    if (limitRef.current !== null) window.clearTimeout(limitRef.current);
    countdownRef.current = null;
    limitRef.current = null;
  }, []);

  const releaseMedia = useCallback((stopRecorder: boolean) => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && stopRecorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // The browser may have stopped the recorder already.
      }
    }
    recorderRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, [clearTimers]);

  const stopAndPause = useCallback(async (automatic: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || stopRequestedRef.current || recorder.state === "inactive") return;
    stopRequestedRef.current = true;
    clearTimers();
    setSecondsRemaining(automatic ? 0 : Math.max(0, Math.ceil((MAX_RECORDING_DURATION_MS - (Date.now() - startedAtRef.current)) / 1000)));
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    try {
      recorder.stop();
      await stopped;
    } catch {
      releaseMedia(true);
      setError(text.recordingFailed);
      setState((current) => transitionCaptureState(current, "DISCARD"));
      return;
    }

    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    releaseMedia(false);
    chunksRef.current = [];
    if (cancelledRef.current) return;
    if (!blob.size) {
      setError(text.emptyRecording);
      setState((current) => transitionCaptureState(current, "DISCARD"));
      return;
    }
    audioBlobRef.current = blob;
    pendingTranscriptRef.current = null;
    setError("");
    setState("paused");
  }, [clearTimers, releaseMedia, setError, text]);

  const start = useCallback(async () => {
    if (state !== "idle" || permissionRequestRef.current || requestInFlightRef.current) return;
    setError("");
    setSecondsRemaining(60);
    cancelledRef.current = false;
    stopRequestedRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(text.unsupportedRecording);
      return;
    }
    const mimeType = typeof MediaRecorder.isTypeSupported === "function"
      ? ["audio/webm;codecs=opus", "audio/webm"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate))
      : undefined;
    if (!mimeType) {
      setError(text.unsupportedFormat);
      return;
    }

    permissionRequestRef.current = true;
    setState((current) => transitionCaptureState(current, "REQUEST_PERMISSION"));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        for (const track of stream.getTracks()) track.stop();
        permissionRequestRef.current = false;
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError(text.recordingFailed);
        releaseMedia(true);
        setState((current) => transitionCaptureState(current, "DISCARD"));
      };
      recorder.start(250);
      startedAtRef.current = Date.now();
      permissionRequestRef.current = false;
      setState((current) => transitionCaptureState(current, "PERMISSION_GRANTED"));
      countdownRef.current = window.setInterval(() => {
        setSecondsRemaining(Math.max(0, Math.ceil((MAX_RECORDING_DURATION_MS - (Date.now() - startedAtRef.current)) / 1000)));
      }, 250);
      limitRef.current = window.setTimeout(() => {
        void stopAndPause(true);
      }, MAX_RECORDING_DURATION_MS);
    } catch (captureError) {
      permissionRequestRef.current = false;
      releaseMedia(true);
      setState((current) => transitionCaptureState(current, "PERMISSION_FAILED"));
      const name = captureError instanceof Error ? captureError.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? text.permissionDenied
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? text.microphoneUnavailable
          : text.recordingFailed);
    }
  }, [releaseMedia, setError, state, stopAndPause, text]);

  const stop = useCallback(() => {
    void stopAndPause(false);
  }, [stopAndPause]);

  const send = useCallback(async (
    onTranscript: (transcript: string) => boolean | void | Promise<boolean | void>,
    onProcessing?: (processing: boolean) => void,
    options: VoiceSendOptions = {},
  ): Promise<void> => {
    if (state !== "paused" || requestInFlightRef.current) return;
    const audio = audioBlobRef.current;
    if (!audio && !pendingTranscriptRef.current) return;
    requestInFlightRef.current = true;
    cancelledRef.current = false;
    const controller = new AbortController();
    requestRef.current = controller;
    let processing = true;
    setError("");
    setState((current) => transitionCaptureState(current, "TRANSCRIBE"));
    onProcessing?.(true);

    try {
      if (audio && audio.size > MAX_CAPTURE_SIZE) throw new Error(text.recordingTooLarge);
      if (audio && !pendingTranscriptRef.current) {
        const form = new FormData();
        form.append("audio", audio, "voice-message.webm");
        const response = await fetch("/api/ask/transcribe", {
          method: "POST",
          body: form,
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as { transcript?: unknown };
        if (!response.ok || typeof payload.transcript !== "string" || !payload.transcript.trim()) {
          throw new Error(response.status === 413
            ? text.recordingTooLarge
            : response.status === 415
              ? text.unsupportedFormat
              : response.status === 400
                ? text.emptyRecording
                : text.transcriptionFailed);
        }
        pendingTranscriptRef.current = payload.transcript.trim();
      }
      const transcript = pendingTranscriptRef.current;
      if (!transcript) throw new Error(text.transcriptionFailed);
      if (options.resetAfterTranscription) {
        audioBlobRef.current = null;
        pendingTranscriptRef.current = null;
        setSecondsRemaining(60);
        setState((current) => transitionCaptureState(current, "TRANSCRIPTION_SUCCEEDED"));
        onProcessing?.(false);
        processing = false;
      }
      const accepted = await onTranscript(transcript);
      if (accepted === false) {
        if (!options.resetAfterTranscription) setState("paused");
        return;
      }
      audioBlobRef.current = null;
      pendingTranscriptRef.current = null;
      setSecondsRemaining(60);
      setState((current) => transitionCaptureState(current, "TRANSCRIPTION_SUCCEEDED"));
    } catch (sendError) {
      if (cancelledRef.current || (sendError instanceof Error && sendError.name === "AbortError")) return;
      setError(sendError instanceof Error && sendError.message === text.recordingTooLarge
        ? text.recordingTooLarge
        : sendError instanceof Error && sendError.message === text.emptyRecording
          ? text.emptyRecording
          : sendError instanceof Error && sendError.message === text.unsupportedFormat
            ? text.unsupportedFormat
            : text.transcriptionFailed);
      if (options.resetOnFailure) {
        audioBlobRef.current = null;
        pendingTranscriptRef.current = null;
        chunksRef.current = [];
        setSecondsRemaining(60);
        setState((current) => transitionCaptureState(current, "DISCARD"));
      } else {
        setState((current) => transitionCaptureState(current, "TRANSCRIPTION_FAILED"));
      }
    } finally {
      if (requestRef.current === controller) {
        requestInFlightRef.current = false;
        requestRef.current = null;
        if (processing) onProcessing?.(false);
      }
    }
  }, [setError, state, text]);

  const discard = useCallback(() => {
    cancelledRef.current = true;
    requestRef.current?.abort();
    requestRef.current = null;
    requestInFlightRef.current = false;
    releaseMedia(true);
    audioBlobRef.current = null;
    pendingTranscriptRef.current = null;
    chunksRef.current = [];
    setError("");
    setSecondsRemaining(60);
    setState((current) => transitionCaptureState(current, "DISCARD"));
  }, [releaseMedia, setError]);

  useEffect(() => () => {
    cancelledRef.current = true;
    requestRef.current?.abort();
    releaseMedia(true);
  }, [releaseMedia]);

  return { state, secondsRemaining, error, setError, start, stop, send, discard };
}
