import { createPrivateKey } from "node:crypto";
import { GoogleServiceError } from "./errors.ts";

export const GA4_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const SEARCH_CONSOLE_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type ServiceAccountCredentials = {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  tokenUri: "https://oauth2.googleapis.com/token";
};

type ServiceAccountJson = {
  type?: unknown;
  client_email?: unknown;
  private_key?: unknown;
  private_key_id?: unknown;
  token_uri?: unknown;
};

export function decodeServiceAccountCredentials(encoded: string | undefined): ServiceAccountCredentials {
  if (!encoded) throw new GoogleServiceError("credentials_missing");
  if (encoded.length > 48_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new GoogleServiceError("credentials_invalid");
  }

  let decodedText: string;
  try {
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.byteLength > 32_000 || decoded.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
      throw new Error("invalid base64");
    }
    decodedText = decoded.toString("utf8");
  } catch {
    throw new GoogleServiceError("credentials_invalid");
  }

  let serviceAccount: ServiceAccountJson;
  try {
    serviceAccount = JSON.parse(decodedText) as ServiceAccountJson;
  } catch {
    throw new GoogleServiceError("credentials_invalid");
  }

  const email = serviceAccount.client_email;
  const privateKey = serviceAccount.private_key;
  const tokenUri = serviceAccount.token_uri;
  if (
    serviceAccount.type !== "service_account" ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email) ||
    typeof privateKey !== "string" ||
    !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    tokenUri !== "https://oauth2.googleapis.com/token" ||
    (serviceAccount.private_key_id !== undefined && typeof serviceAccount.private_key_id !== "string")
  ) {
    throw new GoogleServiceError("credentials_invalid");
  }

  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error("unsupported key");
    }
  } catch {
    throw new GoogleServiceError("credentials_invalid");
  }

  return {
    clientEmail: email,
    privateKey,
    privateKeyId: typeof serviceAccount.private_key_id === "string" ? serviceAccount.private_key_id : undefined,
    tokenUri: "https://oauth2.googleapis.com/token",
  };
}
