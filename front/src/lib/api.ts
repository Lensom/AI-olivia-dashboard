/** Ports the Next.js dev server runs on; there the API is a separate uvicorn process on :8000. */
const LOCAL_DEV_PORTS = new Set(["3000", "3001"]);

function getDefaultApiBase(): string {
  if (typeof window !== "undefined") {
    // Local dev: same host as the page (works from a LAN IP or another device too), port 8000.
    if (LOCAL_DEV_PORTS.has(window.location.port)) return `http://${window.location.hostname}:8000/api`;
    // Deployed (Vercel): the API is served from the same domain under /api.
    return "/api";
  }
  return "http://127.0.0.1:8000/api";
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? getDefaultApiBase();

/** `status` 0 means the request never got an answer (server down, no network); 408, that it took too long. */
export type ApiError = {
  status: number;
  message: string;
};

/** Dispatched on window when a request sent with a token gets 401; `detail` is that token. */
export const AUTH_EXPIRED_EVENT = "olivia:auth-expired";

/** FastAPI errors are {"detail": "..."} or, for validation, {"detail": [{"msg": "..."}]}. */
async function readError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let message = text || res.statusText;
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0] && typeof detail[0].msg === "string") message = detail[0].msg;
  } catch {
    // Not JSON: keep the raw text.
  }
  return { status: res.status, message };
}

/** How long a request may take before it's given up, so a page never waits forever on an answer that won't come. */
const TIMEOUT_MS = 60_000;
/** AI, imports, vacancies and Wikidata can legitimately take minutes. */
const SLOW_TIMEOUT_MS = 180_000;
const SLOW_PATHS = /^\/(investing\/(chat|analysis)|life\/jobs\/(refresh|score|cv)|library\/(ai|series|wikidata|import|match-many)|cinema\/(ai|import|match-many))/;

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { token?: string; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  // AbortController and setTimeout rather than AbortSignal.timeout/any, which older phones' browsers lack.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? (SLOW_PATHS.test(path) ? SLOW_TIMEOUT_MS : TIMEOUT_MS));
  const callerSignal = opts.signal;
  const forward = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", forward, { once: true });
  const { signal } = controller;
  const headers = new Headers(opts.headers);
  // FormData needs the browser-generated multipart boundary, so leave Content-Type unset for it.
  if (!(opts.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);

  const tooSlow = { status: 408, message: "The server took too long to answer. Try again." } satisfies ApiError;
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...opts, headers, signal });
    } catch {
      throw timedOut ? tooSlow : ({ status: 0, message: "Can’t reach the server" } satisfies ApiError);
    }
    if (!res.ok) {
      if (res.status === 401 && opts.token && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: opts.token }));
      }
      throw await readError(res);
    }
    if (res.status === 204) return undefined as T; // "done", with no body to read
    try {
      return (await res.json()) as T; // the timeout covers the body too: it can stall after the headers arrived
    } catch (err) {
      if (timedOut) throw tooSlow;
      throw err;
    }
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forward);
  }
}

