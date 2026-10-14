function getDefaultApiBase(): string {
  // If frontend is opened via a LAN IP (or another device),
  // 127.0.0.1 would point to the *client* machine. Use current hostname instead.
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
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

