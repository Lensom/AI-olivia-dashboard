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

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? getDefaultApiBase();

/** `status` 0 means the request never got an answer (server down, no network). */
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

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(opts.headers);
  // FormData needs the browser-generated multipart boundary, so leave Content-Type unset for it.
  if (!(opts.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);

  let res: Response;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch {
    throw { status: 0, message: "Can’t reach the server" } satisfies ApiError;
  }
  if (!res.ok) {
    if (res.status === 401 && opts.token && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: opts.token }));
    }
    throw await readError(res);
  }
  return (await res.json()) as T;
}

