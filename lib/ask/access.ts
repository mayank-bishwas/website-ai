import {
  isMerchantAuthenticated,
  shouldUseSecureCookie,
} from "./merchant-auth.ts";

export function isAskLocalAccessAllowed(environment: {
  nodeEnv: string | undefined;
  vercel: string | undefined;
  hostname: string;
}): boolean {
  if (environment.nodeEnv !== "development" || Boolean(environment.vercel)) return false;
  const hostname = environment.hostname.replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isAllowedLocalAskOrigin(input: {
  origin: string | null;
  requestUrl: string;
  hostHeader: string | null;
}): boolean {
  if (input.origin === null) return true;
  if (!input.hostHeader) return false;

  try {
    const origin = new URL(input.origin);
    const requestUrl = new URL(input.requestUrl);
    const hostUrl = new URL(`${requestUrl.protocol}//${input.hostHeader}`);
    const isLoopback = (hostname: string) => {
      const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
    };

    // Next's local request URL can use a loopback alias different from the
    // browser's address. The Host header reflects the origin that received it.
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      origin.host.toLowerCase() === hostUrl.host.toLowerCase() &&
      isLoopback(origin.hostname) &&
      isLoopback(hostUrl.hostname)
    );
  } catch {
    return false;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const hostHeader = request.headers.get("host");
  if (origin === null) return true; // non-browser clients (e.g., scripts)
  if (!hostHeader) return false;
  try {
    const originUrl = new URL(origin);
    const hostUrl = new URL(`${originUrl.protocol}//${hostHeader}`);
    return originUrl.host.toLowerCase() === hostUrl.host.toLowerCase();
  } catch {
    return false;
  }
}

export { isMerchantAuthenticated } from "./merchant-auth.ts";
export { shouldUseSecureCookie } from "./merchant-auth.ts";
