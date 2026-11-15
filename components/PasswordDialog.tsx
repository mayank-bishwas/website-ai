"use client";

import { FormEvent, useState } from "react";
import { Icon } from "./Icon";
import { Locale, passwordText } from "@/lib/portal-i18n";

export function PasswordDialog({
  locale,
  onClose,
  onUnlock,
}: {
  locale: Locale;
  onClose: () => void;
  onUnlock: (password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const text = passwordText[locale];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const unlocked = await onUnlock(password);
      setError(unlocked ? "" : text.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        aria-labelledby="password-title"
        aria-modal="true"
        className="dialog password-dialog"
        role="dialog"
      >
        <div className="dialog-icon"><Icon name="lock" size={22} /></div>
        <h2 id="password-title">{text.title}</h2>
        <form className="password-form" onSubmit={submit}>
          <div className="password-input-wrap">
            <input
              aria-label={text.placeholder}
              autoComplete="off"
              autoFocus
              id="merchant-password"
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder={text.placeholder}
              type="password"
              value={password}
            />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="button button-primary full-width" type="submit">
            {text.continue} <Icon name="arrow-up" size={17} />
          </button>
        </form>
      </section>
    </div>
  );
}
