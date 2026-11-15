"use client";

import { ChangeEvent, FormEvent, useRef } from "react";
import { MockImage } from "@/lib/interactions";
import { Icon } from "./Icon";

export type VoiceState = "idle" | "recording" | "paused";

type Props = {
  mode: "ASK" | "EDIT";
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  voiceState: VoiceState;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onDeleteRecording: () => void;
  onSendRecording: () => void;
  images: MockImage[];
  onImagesSelected: (files: FileList | null) => void;
  onRemoveImage: (index: number) => void;
  startVoiceLabel?: string;
  voiceControlsLabel?: string;
  sendLabel?: string;
  askPlaceholder?: string;
  askInputLabel?: string;
  editPlaceholder?: string;
  editInputLabel?: string;
  addImageLabel?: string;
  maximumImagesLabel?: string;
  removeImageLabel?: string;
  showStopResponse?: boolean;
  onStopResponse?: () => void;
  stopResponseLabel?: string;
  disabled?: boolean;
};

export function Composer({
  mode,
  draft,
  onDraftChange,
  onSubmit,
  voiceState,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onDeleteRecording,
  onSendRecording,
  images,
  onImagesSelected,
  onRemoveImage,
  startVoiceLabel = "Start voice message",
  voiceControlsLabel = "Voice recording controls",
  sendLabel = "Send message",
  askPlaceholder,
  askInputLabel,
  editPlaceholder = "Type a message or choose an action above…",
  editInputLabel = "Write an inventory message",
  addImageLabel = "Add image",
  maximumImagesLabel = "Maximum two images",
  removeImageLabel = "Remove image",
  showStopResponse = false,
  onStopResponse,
  stopResponseLabel = "Stop response",
  disabled = false,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    onImagesSelected(event.target.files);
    event.target.value = "";
  }

  if (mode === "ASK" && voiceState !== "idle") {
    return (
      <div className={`composer voice-composer ${voiceState}`} aria-label={voiceControlsLabel}>
        <span className="recording-dot" />
        <span className="voice-status">
          {voiceState === "recording" ? "Recording a voice message…" : "Recording paused"}
        </span>
        <div className="voice-actions">
          {voiceState === "recording" ? (
            <button className="button button-subtle" onClick={onPauseRecording} type="button">
              <Icon name="pause" size={17} /> Pause
            </button>
          ) : (
            <>
              <button className="button button-subtle" onClick={onDeleteRecording} type="button">
                <Icon name="trash" size={17} /> Delete
              </button>
              <button className="button button-subtle" onClick={onResumeRecording} type="button">
                <Icon name="play" size={17} /> Resume
              </button>
              <button className="round-button send-button" onClick={onSendRecording} type="button" aria-label="Send voice message">
                <Icon name="arrow-up" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className={`composer ${mode === "EDIT" ? "edit-composer" : ""}`} onSubmit={submit}>
      {mode === "EDIT" && (
        <>
          <input
            accept="image/*"
            aria-hidden="true"
            className="visually-hidden"
            hidden
            multiple
            onChange={selectImages}
            ref={fileInput}
            tabIndex={-1}
            type="file"
          />
          <button
            aria-label={addImageLabel}
            className="icon-button attach-button"
            disabled={images.length >= 2 || disabled}
            onClick={() => fileInput.current?.click()}
            title={images.length >= 2 ? maximumImagesLabel : addImageLabel}
            type="button"
          >
            <Icon name="image" />
          </button>
        </>
      )}
      <div className="composer-content">
        {images.length > 0 && (
          <div className="composer-previews">
            {images.map((image, index) => (
              <div className="composer-preview" key={`${image.name}-${index}`}>
                <img alt={image.name} src={image.src} />
                <button aria-label={`${removeImageLabel} ${image.name}`} className="preview-remove" onClick={() => onRemoveImage(index)} type="button">
                  <Icon name="close" size={14} />
                </button>
                <span>{image.name}</span>
              </div>
            ))}
          </div>
        )}
        <textarea
          aria-label={mode === "ASK" ? askInputLabel ?? "Ask Shahi Meva" : editInputLabel}
          disabled={disabled}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!disabled && (draft.trim() || images.length > 0)) onSubmit();
            }
          }}
          placeholder={mode === "ASK" ? askPlaceholder ?? "Ask Shahi Meva about products, prices, or availability..." : editPlaceholder}
          rows={1}
          value={draft}
        />
      </div>
      {mode === "ASK" && !draft.trim() && showStopResponse && onStopResponse ? (
        <button
          aria-label={stopResponseLabel}
          className="round-button stop-button"
          onClick={onStopResponse}
          type="button"
        >
          <Icon name="stop" size={17} />
        </button>
      ) : mode === "ASK" && !draft.trim() ? (
        <button aria-label={startVoiceLabel} className="round-button mic-button" disabled={disabled} onClick={onStartRecording} type="button">
          <Icon name="mic" size={19} />
        </button>
      ) : (
        <button
          aria-label={sendLabel}
          className="round-button send-button"
          disabled={disabled || (!draft.trim() && images.length === 0)}
          type="submit"
        >
          <Icon name="arrow-up" />
        </button>
      )}
    </form>
  );
}
