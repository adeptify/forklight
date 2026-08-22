/**
 * Canonical per-Worker network policy (FL-107).
 *
 * One closed policy shape decides whether a built-in Runtime child process
 * inherits the Daemon network environment, forces a direct connection, or
 * routes through a credential-free local proxy. The selected policy is frozen
 * into each Task at creation and every built-in Runtime adapter applies it
 * through this single shared environment transformation.
 *
 * Privacy contract: validation fails closed with fixed, non-echoing errors.
 * Proxy URLs, hostnames, credentials, no-proxy lists, and environment values
 * never appear in durable events, public errors, or Hub summaries.
 */

/** Canonical modes. Legacy profiles and Tasks with no field resolve to inherit. */
type WorkerNetworkPolicyMode = "inherit" | "direct" | "custom-proxy";

/**
 * Canonical per-Worker network policy. `custom-proxy` requires one bounded
 * credential-free HTTP(S) proxy URL; an HTTPS proxy URL and a no-proxy list
 * are optional bounded refinements.
 */
export type WorkerNetworkPolicy =
  | { mode: "inherit" }
  | { mode: "direct" }
  | {
      mode: "custom-proxy";
      /** Bounded credential-free HTTP proxy URL (http:// or https://). */
      httpProxy: string;
      /** Optional bounded HTTPS proxy URL; falls back to httpProxy when absent. */
      httpsProxy?: string;
      /** Bounded NO_PROXY list; a safe localhost default is applied when absent. */
      noProxy?: string;
    };

const PROXY_URL_MAX = 512;
const NO_PROXY_MAX = 1024;
const PROXY_SCHEMES = new Set(["http:", "https:"]);
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

/** Safe localhost exclusions applied when a custom proxy omits a no-proxy list. */
export const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";

// Fixed, non-echoing rejection messages. The rejected value is never
// interpolated, so private hostnames and credentials cannot leak through
// validation errors.
const PROXY_INVALID_MSG =
  "must be a plain http:// or https:// proxy origin (host and optional port) without embedded credentials, path, query, or fragment";
const NO_PROXY_INVALID_MSG = "noProxy is malformed";
const UNSUPPORTED_FIELD_MSG = "contains an unsupported field";
const UNSUPPORTED_MODE_MSG = "must be inherit, direct, or custom-proxy";
const SHAPE_MSG = "must be an object when supplied";
const PROXY_REQUIRED_MSG = "custom-proxy requires an httpProxy URL";

/** True when the string contains a control character (0x00-0x20) or DEL (0x7f). */
function hasControlOrSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isValidProxyUrl(value: string): boolean {
  if (value.length === 0 || value.length > PROXY_URL_MAX) return false;
  // Reject control characters, whitespace, and credential separators.
  if (hasControlOrSpace(value)) return false;
  if (value.includes("@")) return false;
  const schemeEnd = value.indexOf("://");
  if (schemeEnd <= 0) return false;
  const scheme = value.slice(0, schemeEnd + 1);
  if (!PROXY_SCHEMES.has(scheme)) return false;
  const rest = value.slice(schemeEnd + 3);
  if (rest.length === 0) return false;
  // Origin only: no path, query, or fragment.
  if (rest.includes("/") || rest.includes("?") || rest.includes("#")) return false;
  const colon = rest.indexOf(":");
  if (colon === -1) {
    return /^[A-Za-z0-9._~-]+$/.test(rest);
  }
  const host = rest.slice(0, colon);
  const portRaw = rest.slice(colon + 1);
  if (host.length === 0 || portRaw.length === 0) return false;
  if (rest.includes(":", colon + 1)) return false;
  if (!/^[A-Za-z0-9._~-]+$/.test(host)) return false;
  if (!/^\d{1,5}$/.test(portRaw)) return false;
  const port = Number(portRaw);
  return port >= 1 && port <= 65535;
}

function isValidNoProxy(value: string): boolean {
  if (value.length === 0 || value.length > NO_PROXY_MAX) return false;
  // No control characters or whitespace anywhere in the list.
  if (hasControlOrSpace(value)) return false;
  if (value.startsWith(",") || value.endsWith(",") || value.includes(",,")) {
    return false;
  }
  const entries = value.split(",");
  if (entries.length === 0) return false;
  return entries.every((entry) => /^[A-Za-z0-9._\-:*]+$/.test(entry));
}

/**
 * Validate one closed network-policy shape. Legacy absence (`undefined`)
 * resolves to inherit behavior and returns `undefined`. Unknown fields,
 * unsupported modes, malformed proxy URLs, embedded credentials, control
 * characters, and malformed no-proxy values fail closed with fixed errors that
 * never echo the private input.
 */
export function validateWorkerNetworkPolicy(
  raw: unknown,
  label = "networkPolicy",
): WorkerNetworkPolicy | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} ${SHAPE_MSG}`);
  }
  const input = raw as Record<string, unknown>;
  const mode = input.mode;
  if (mode === "inherit" || mode === "direct") {
    for (const key of Object.keys(input)) {
      if (key !== "mode") throw new Error(`${label} ${UNSUPPORTED_FIELD_MSG}`);
    }
    return { mode };
  }
  if (mode === "custom-proxy") {
    let httpProxy: string | undefined;
    let httpsProxy: string | undefined;
    let noProxy: string | undefined;
    for (const [key, value] of Object.entries(input)) {
      if (key === "mode") continue;
      if (key === "httpProxy") {
        if (typeof value !== "string" || !isValidProxyUrl(value)) {
          throw new Error(`${label} ${PROXY_INVALID_MSG}`);
        }
        httpProxy = value;
        continue;
      }
      if (key === "httpsProxy") {
        if (typeof value !== "string" || !isValidProxyUrl(value)) {
          throw new Error(`${label} ${PROXY_INVALID_MSG}`);
        }
        httpsProxy = value;
        continue;
      }
      if (key === "noProxy") {
        if (typeof value !== "string" || !isValidNoProxy(value)) {
          throw new Error(`${label} ${NO_PROXY_INVALID_MSG}`);
        }
        noProxy = value;
        continue;
      }
      throw new Error(`${label} ${UNSUPPORTED_FIELD_MSG}`);
    }
    if (httpProxy === undefined) throw new Error(`${label} ${PROXY_REQUIRED_MSG}`);
    return {
      mode: "custom-proxy",
      httpProxy,
      ...(httpsProxy === undefined ? {} : { httpsProxy }),
      ...(noProxy === undefined ? {} : { noProxy }),
    };
  }
  throw new Error(`${label} ${UNSUPPORTED_MODE_MSG}`);
}

/** Freeze a validated policy so the immutable per-Task snapshot cannot be
 *  rewritten by later settings edits. Shallow freeze is sufficient: every value
 *  is a primitive string or the closed mode enum. */
export function freezeWorkerNetworkPolicy(
  policy: WorkerNetworkPolicy,
): WorkerNetworkPolicy {
  if (policy.mode === "custom-proxy") {
    return Object.freeze({
      mode: "custom-proxy",
      httpProxy: policy.httpProxy,
      ...(policy.httpsProxy === undefined ? {} : { httpsProxy: policy.httpsProxy }),
      ...(policy.noProxy === undefined ? {} : { noProxy: policy.noProxy }),
    });
  }
  return Object.freeze({ mode: policy.mode });
}

/** Safe mode-level evidence for Worker-start events. Legacy absence is inherit.
 *  Never returns proxy URLs, hostnames, credentials, or no-proxy content. */
export function workerNetworkPolicyMode(
  policy: WorkerNetworkPolicy | undefined,
): WorkerNetworkPolicyMode {
  return policy?.mode ?? "inherit";
}

/**
 * Transform a base child environment deterministically without mutating the
 * caller's object. `inherit` (and legacy absence) preserves the base Daemon
 * environment; `direct` removes every supported proxy variable; `custom-proxy`
 * starts from the cleaned environment, sets upper- and lower-case HTTP/HTTPS
 * values consistently, and applies a bounded NO_PROXY value with a safe
 * localhost default. Unrelated environment and Runtime authentication values
 * are never touched.
 */
export function applyWorkerNetworkPolicy(
  baseEnvironment: NodeJS.ProcessEnv,
  policy: WorkerNetworkPolicy | undefined,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...baseEnvironment };
  if (policy === undefined || policy.mode === "inherit") return next;
  for (const key of PROXY_ENV_KEYS) delete next[key];
  if (policy.mode === "direct") return next;
  next.HTTP_PROXY = policy.httpProxy;
  next.http_proxy = policy.httpProxy;
  const httpsProxy = policy.httpsProxy ?? policy.httpProxy;
  next.HTTPS_PROXY = httpsProxy;
  next.https_proxy = httpsProxy;
  const noProxy = policy.noProxy ?? DEFAULT_NO_PROXY;
  next.NO_PROXY = noProxy;
  next.no_proxy = noProxy;
  return next;
}
