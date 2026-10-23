"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch, AUTH_EXPIRED_EVENT, type ApiError } from "@/lib/api";

type User = { id: number; email: string };

/**
 * loading    — reading the saved session or checking it with the server
 * signed-in  — the server confirmed the token
 * signed-out — no token (never logged in, logged out, or the session expired)
 * offline    — there is a token but the server can't be reached; retried automatically
 */
export type AuthStatus = "loading" | "signed-in" | "signed-out" | "offline";

type AuthStore = {
  token: string | null;
  user: User | null;
  status: AuthStatus;
  isLoading: boolean;
  /** True when the last session ended by itself (token expired or revoked), not by Logout. */
  sessionExpired: boolean;
  /** True right after Logout in this tab (pages then send you to /login without ?next=). */
  loggedOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const STORAGE_KEY = "olivia.jarvis.auth.token.v1";
const EXPIRED_KEY = "olivia.auth.expired.v1";
/** Fired in this tab when the token changes; other tabs get the browser's "storage" event. */
const CHANGE_EVENT = "olivia:auth-token";
const RETRY_MS = 3000;

function readToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null, expired = false) {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
    if (expired) window.sessionStorage.setItem(EXPIRED_KEY, "1");
    else window.sessionStorage.removeItem(EXPIRED_KEY);
  } catch {
    // Storage blocked: the session lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function readExpired(): boolean {
  try {
    return window.sessionStorage.getItem(EXPIRED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const subscribeNothing = () => () => {};

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // The server render and the first client render have no session (so hydration matches);
  // the saved token applies right after, together with `hydrated`.
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const sessionExpired = useSyncExternalStore(subscribe, readExpired, () => false);
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  // The user is stored with the token it was checked for, so a new login never shows the old one.
  const [checked, setChecked] = useState<{ token: string; user: User } | null>(null);
  const [offlineToken, setOfflineToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    apiFetch<User>("/auth/me", { token })
      .then((user) => {
        if (!alive) return;
        setChecked({ token, user });
        setOfflineToken(null);
      })
      .catch((err: ApiError) => {
        // 401 is handled by the AUTH_EXPIRED_EVENT listener below; anything else (backend down,
        // restarting, no network) keeps the session and tries again.
        if (!alive || err.status === 401) return;
        setOfflineToken(token);
        timer = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, attempt]);

  // Any request answered with 401 ends the session — but only if it was sent with the current token.
  useEffect(() => {
    const onExpired = (e: Event) => {
      const sent = (e as CustomEvent<string>).detail;
      if (sent && sent === readToken()) writeToken(null, true);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password }),
    });
    writeToken(res.access_token);
    setLoggedOut(false);
  }, []);

  const register = useCallback(
    async (email: string, password: string) => {
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    setLoggedOut(true);
    writeToken(null);
    setChecked(null);
  }, []);

  const user = token && checked?.token === token ? checked.user : null;
  const status: AuthStatus = !hydrated
    ? "loading"
    : !token
      ? "signed-out"
      : user
        ? "signed-in"
        : offlineToken === token
          ? "offline"
          : "loading";

  const value = useMemo(
    () => ({ token, user, status, isLoading: status === "loading", sessionExpired, loggedOut, login, register, logout }),
    [token, user, status, sessionExpired, loggedOut, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Remounts everything below it when the session changes, so no data from the previous session
 * (or the previous user) stays in memory after logout or a new login.
 */
export function SessionScope({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return <SessionKeyed key={token ?? "signed-out"}>{children}</SessionKeyed>;
}

function SessionKeyed({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Where to go after login: a same-site path from `?next=`, never back to /login. */
export function safeNextPath(next: string | null, fallback = "/investing"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return fallback;
  return next;
}
