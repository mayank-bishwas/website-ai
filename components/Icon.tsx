type IconName =
  | "search"
  | "info"
  | "external"
  | "lock"
  | "unlock"
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
  | "stop";

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
    </svg>
  );
}
