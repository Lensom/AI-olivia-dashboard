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

export type ApiError = {
  status: number;
  message: string;
};

async function readError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  return { status: res.status, message: text || res.statusText };
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

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

