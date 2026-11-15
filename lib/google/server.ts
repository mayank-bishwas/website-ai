import "server-only";

import { decodeServiceAccountCredentials } from "./credentials";
import { GoogleServiceError } from "./errors";
import { requestGoogleAccessToken } from "./token";

const allowedGoogleHosts = new Set(["analyticsdata.googleapis.com", "www.googleapis.com"]);

export async function createGoogleReportingClient(scopes: string[]) {
  const credentials = decodeServiceAccountCredentials(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64);
  const accessToken = await requestGoogleAccessToken(credentials, scopes);

  return {
    async postJson(urlValue: string, body: unknown): Promise<unknown> {
      let url: URL;
      try {
        url = new URL(urlValue);
      } catch {
        throw new GoogleServiceError("api_rejected");
      }
      if (url.protocol !== "https:" || !allowedGoogleHosts.has(url.hostname)) {
        throw new GoogleServiceError("api_rejected");
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
      } catch (error) {
        throw new GoogleServiceError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "service_unavailable");
      }

      if (!response.ok) {
        if (response.status === 401) throw new GoogleServiceError("authentication_failed");
        if (response.status === 403) throw new GoogleServiceError("permission_denied");
        if (response.status === 429) throw new GoogleServiceError("quota_exceeded");
        if (response.status >= 500) throw new GoogleServiceError("service_unavailable");
        throw new GoogleServiceError("api_rejected");
      }

      try {
        return await response.json();
      } catch {
        throw new GoogleServiceError("invalid_response");
      }
    },
  };
}
