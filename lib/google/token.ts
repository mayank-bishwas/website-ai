import { createSign } from "node:crypto";
import { GoogleServiceError } from "./errors.ts";
import type { ServiceAccountCredentials } from "./credentials.ts";

const allowedScopes = new Set([
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
]);

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export async function requestGoogleAccessToken(
  credentials: ServiceAccountCredentials,
  scopes: string[],
  fetcher: typeof fetch = fetch,
  now = Date.now,
): Promise<string> {
  if (!scopes.length || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new GoogleServiceError("credentials_invalid");
  }

  const issuedAt = Math.floor(now() / 1000);
  const header = { alg: "RS256", typ: "JWT", ...(credentials.privateKeyId ? { kid: credentials.privateKeyId } : {}) };
  const claims = {
    iss: credentials.clientEmail,
    scope: [...new Set(scopes)].join(" "),
    aud: credentials.tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsignedAssertion = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;

  let assertion: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(unsignedAssertion);
    assertion = `${unsignedAssertion}.${signer.sign(credentials.privateKey, "base64url")}`;
  } catch {
    throw new GoogleServiceError("credentials_invalid");
  }

  let response: Response;
  try {
    response = await fetcher(credentials.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new GoogleServiceError(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "service_unavailable");
  }

  if (!response.ok) {
    throw new GoogleServiceError(response.status === 401 || response.status === 400 ? "authentication_failed" : "service_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GoogleServiceError("invalid_response");
  }
  const accessToken = (payload as { access_token?: unknown }).access_token;
  const expiresIn = (payload as { expires_in?: unknown }).expires_in;
  if (typeof accessToken !== "string" || !accessToken || typeof expiresIn !== "number" || expiresIn <= 0) {
    throw new GoogleServiceError("invalid_response");
  }

  return accessToken;
}
