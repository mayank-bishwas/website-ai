export type GoogleFailureReason =
  | "credentials_missing"
  | "credentials_invalid"
  | "authentication_failed"
  | "permission_denied"
  | "quota_exceeded"
  | "timeout"
  | "service_unavailable"
  | "api_rejected"
  | "invalid_response";

export class GoogleServiceError extends Error {
  readonly reason: GoogleFailureReason;

  constructor(reason: GoogleFailureReason) {
    super("Google reporting request failed.");
    this.name = "GoogleServiceError";
    this.reason = reason;
  }
}

export function googleFailureMessage(reason: GoogleFailureReason, sourceLabel: string): string {
  switch (reason) {
    case "credentials_missing":
    case "credentials_invalid":
      return "Google reporting credentials are missing or invalid in the server configuration.";
    case "authentication_failed":
      return "Google could not authenticate the configured service account.";
    case "permission_denied":
      return `Google denied access to ${sourceLabel}. Check that the API is enabled and the service account has read permission.`;
    case "quota_exceeded":
      return `Google temporarily rate-limited ${sourceLabel}. Please try again shortly.`;
    case "timeout":
    case "service_unavailable":
      return `${sourceLabel} is temporarily unavailable. Please try again shortly.`;
    case "api_rejected":
    case "invalid_response":
      return `Google could not return a valid ${sourceLabel} report for this request.`;
  }
}
