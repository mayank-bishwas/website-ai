"use client";

import { Composer } from "@/components/Composer";
import { Icon } from "@/components/Icon";
import { askText, Locale, voiceText } from "@/lib/portal-i18n";
import { formatRecordingCountdown } from "@/lib/voice/recording-state";
import { useVoiceTranscription } from "@/lib/voice/use-voice-transcription";

type Props = {
  draft: string;
  disabled: boolean;
  locale: Locale;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onSubmitVoice: (transcript: string) => void | Promise<void>;
  onTranscriptionChange: (transcribing: boolean) => void;
  onStopResponse: () => void;
  stopResponseLabel: string;
};

export function AskComposer({
  draft,
  disabled,
  locale,
  onDraftChange,
  onSubmit,
  onSubmitVoice,
  onTranscriptionChange,
  onStopResponse,
  stopResponseLabel,
}: Props) {
  const voice = useVoiceTranscription(locale);
  const text = voiceText[locale];
  const ask = askText[locale];
  const timer = formatRecordingCountdown(voice.secondsRemaining);
  const submitVoiceTranscript = async (transcript: string) => {
    onTranscriptionChange(false);
    await onSubmitVoice(transcript);
  };

  if (voice.state !== "idle" && voice.state !== "transcribing") {
    const status = voice.state === "requesting"
      ? text.permissionWaiting
      : voice.state === "recording"
        ? `${text.recording} · ${timer}`
        : text.recordingStopped;
    return (
      <>
        <div aria-label={text.voiceControls} className={`composer voice-composer ${voice.state}`}>
          <span aria-hidden="true" className="recording-dot" />
          <span aria-live="polite" className="voice-status">{status}</span>
          <div className="voice-actions">
            {voice.state === "requesting" && (
              <button className="button button-subtle" onClick={voice.discard} type="button">{text.discard}</button>
            )}
            {voice.state === "recording" && <>
              <button className="button button-subtle" onClick={voice.discard} type="button">{text.discard}</button>
              <button className="button button-primary" onClick={voice.stop} type="button">
                <Icon name="pause" size={17} />{text.stop}
              </button>
            </>}
            {voice.state === "paused" && <>
              <button className="button button-subtle" onClick={voice.discard} type="button">{text.discard}</button>
              <button
                className="button button-primary"
                onClick={() => void voice.send(submitVoiceTranscript, onTranscriptionChange, {
                  resetAfterTranscription: true,
                  resetOnFailure: true,
                })}
                type="button"
              >
                <Icon name="arrow-up" size={17} />{text.sendRecording}
              </button>
            </>}
          </div>
        </div>
        {voice.error && <p className="inline-error" role="alert">{voice.error}</p>}
      </>
    );
  }

  return (
    <>
      <Composer
        mode="ASK"
        draft={draft}
        disabled={disabled || voice.state === "transcribing"}
        images={[]}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
        onImagesSelected={() => undefined}
        onRemoveImage={() => undefined}
        onStartRecording={() => void voice.start()}
        onStopResponse={onStopResponse}
        stopResponseLabel={stopResponseLabel}
        showStopResponse={disabled}
        onPauseRecording={() => undefined}
        onResumeRecording={() => undefined}
        onDeleteRecording={voice.discard}
        onSendRecording={() => undefined}
        askInputLabel={ask.inputLabel}
        askPlaceholder={ask.placeholder}
        sendLabel={ask.sendMessage}
        editPlaceholder={ask.placeholder}
        startVoiceLabel={text.startVoice}
        voiceControlsLabel={text.voiceControls}
        voiceState="idle"
      />
      {voice.error && <p className="inline-error" role="alert">{voice.error}</p>}
    </>
  );
}
