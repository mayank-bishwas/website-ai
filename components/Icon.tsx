type IconName =
  | "search"
  | "info"
  | "external"
  | "lock"
  | "unlock"
  | "logout"
  | "arrow-up"
  | "mic"
  | "pause"
  | "play"
  | "trash"
  | "copy"
  | "check"
  | "image"
  | "close"
  | "plus"
  | "back"
  | "edit"
  | "restore"
  | "eye"
  | "send"
  | "stop"
  | "menu"
  | "globe"
  | "phone"
  | "whatsapp"
  | "mail"
  | "chevron";

export function Icon({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...common}
    >
      {name === "search" && (
        <>
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.5 4.5" />
        </>
      )}
      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </>
      )}
      {name === "external" && (
        <>
          <path d="M13 5h6v6" />
          <path d="m19 5-9 9" />
          <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v3" />
        </>
      )}
      {name === "unlock" && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 7.5-2" />
          <path d="M12 14v3" />
        </>
      )}
      {name === "logout" && (
        <>
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </>
      )}
      {name === "arrow-up" && (
        <>
          <path d="M12 19V5" />
          <path d="m6 11 6-6 6 6" />
        </>
      )}
      {name === "mic" && (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
        </>
      )}
      {name === "pause" && <path d="M9 5v14m6-14v14" />}
      {name === "play" && <path d="m8 5 11 7-11 7z" />}
      {name === "trash" && (
        <>
          <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" />
        </>
      )}
      {name === "copy" && (
        <>
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h1" />
        </>
      )}
      {name === "check" && <path d="m5 12 4 4L19 6" />}
      {name === "image" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m21 15-5-5L5 20" />
        </>
      )}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {name === "plus" && <path d="M12 5v14m-7-7h14" />}
      {name === "edit" && (
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        </>
      )}
      {name === "restore" && (
        <>
          <path d="M3 11a9 9 0 1 1 2.6 6.4" />
          <path d="M3 4v7h7" />
        </>
      )}
      {name === "back" && (
        <>
          <path d="m12 19-7-7 7-7" />
          <path d="M5 12h14" />
        </>
      )}
      {name === "eye" && (
        <>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
      {name === "send" && (
        <>
          <path d="m21 3-7.5 18-3.2-7.3L3 10.5 21 3Z" />
          <path d="M10.3 13.7 15 9" />
        </>
      )}
      {name === "stop" && <rect x="6" y="6" width="12" height="12" rx="1.5" />}
      {name === "menu" && <path d="M3 12h18M3 6h18M3 18h18" />}
      {name === "globe" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
        </>
      )}
      {name === "phone" && (
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
      )}
      {name === "whatsapp" && (
        <path
          d="M17.472 14.382c-0.297-0.149-1.758-0.867-2.03-0.967c-0.273-0.099-0.471-0.148-0.67 0.15c-0.197 0.297-0.767 0.966-0.94 1.164c-0.173 0.199-0.347 0.223-0.644 0.075c-0.297-0.15-1.255-0.463-2.39-1.475c-0.883-0.788-1.48-1.761-1.653-2.059c-0.173-0.297-0.018-0.458 0.13-0.606c0.134-0.133 0.297-0.347 0.446-0.52c0.149-0.174 0.198-0.298 0.297-0.497c0.1-0.198 0.05-0.371-0.025-0.52c-0.074-0.149-0.669-1.612-0.916-2.207c-0.242-0.579-0.487-0.5-0.669-0.51c-0.173-0.008-0.371-0.01-0.57-0.01c-0.198 0-0.52 0.074-0.792 0.371c-0.272 0.297-1.04 1.016-1.04 2.479c0 1.462 1.065 2.875 1.213 3.074c0.149 0.198 2.096 3.2 5.077 4.487c0.709 0.306 1.262 0.49 1.694 0.627c0.712 0.226 1.36 0.194 1.871 0.118c0.571-0.085 1.758-0.718 2.006-1.41c0.248-0.694 0.248-1.289 0.173-1.41c-0.074-0.124-0.272-0.198-0.57-0.347m-5.421 5.403h-0.004a9.87 9.87 0 0 1-5.031-1.378l-0.361-0.214l-3.741 0.982l0.998-3.648l-0.235-0.374a8.19 8.19 0 0 1-1.26-4.827c0-4.528 3.686-8.213 8.213-8.213c2.196 0 4.258 0.858 5.815 2.414a8.187 8.187 0 0 1 2.402 5.822c-0.003 4.528-3.688 8.213-8.214 8.213m7.119-18.332A10.05 10.05 0 0 0 12.05 0C5.495 0 0.16 5.335 0.157 11.892c0 2.096 0.547 4.142 1.588 5.945L0.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h0.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
          fill="currentColor"
          stroke="none"
        />
      )}
      {name === "mail" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      )}
      {name === "chevron" && <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}
