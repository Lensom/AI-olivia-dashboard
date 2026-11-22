"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";

/** Mirrors back/app/career/router.py. */
export type Stage = "applied" | "recruiter" | "technical" | "final" | "offer";
export type Application = {
  id: string;
  company: string;
  role: string;
  url: string;
  wave: "" | "A" | "B" | "C";
  applied: string;
  channel: "referral" | "recruiter" | "direct" | "cold";
  stage: Stage;
  closed: "" | "rejected" | "withdrawn";
  salary: string;
  sponsorship: "unknown" | "yes" | "no";
  notes: string;
  job_id: string;
};
export type WeekCounts = { messages: number; mock: number; post: number; funnel: boolean };
export type CareerData = {
  progress: Record<string, 1 | 2>;
  checks: Record<string, true>;
  weeks: Record<string, WeekCounts>;
  applications: Application[];
  notes: Record<string, string>;
};

const EMPTY: CareerData = { progress: {}, checks: {}, weeks: {}, applications: [], notes: {} };

type Store = {
  data: CareerData;
  loaded: boolean;
  error: string | null;
  /** Applies a change to one or more parts and saves just those; puts them back if saving fails. */
  update: <K extends keyof CareerData>(parts: K[], change: (d: CareerData) => Pick<CareerData, K>) => void;
};

const Ctx = createContext<Store | null>(null);

export function CareerProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [data, setData] = useState<CareerData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<CareerData>(EMPTY);
  // Saves go one after another, so quick clicks reach the server in the order they were made.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!token) return;
    apiFetch<CareerData>("/life/career", { token })
      .then((d) => {
        latest.current = { ...EMPTY, ...d };
        setData(latest.current);
      })
      .catch(() => setError("Could not load your progress. Is the backend running?"))
      .finally(() => setLoaded(true));
  }, [token]);

  const update = useCallback<Store["update"]>(
    (parts, change) => {
      const prev = latest.current;
      const changed = change(prev);
      const next = { ...prev, ...changed };
      latest.current = next;
      setData(next);
      queue.current = queue.current.then(() =>
        apiFetch("/life/career", { token: token ?? undefined, method: "PUT", body: JSON.stringify(changed) })
          .then(() => setError(null))
          .catch(() => {
            // Only the parts this change touched go back, and only if nothing changed them since.
            const rollback = Object.fromEntries(parts.filter((p) => latest.current[p] === next[p]).map((p) => [p, prev[p]]));
            latest.current = { ...latest.current, ...rollback };
            setData(latest.current);
            setError("Could not save — the change was undone.");
          }),
      );
    },
    [token],
  );

  const value = useMemo(() => ({ data, loaded, error, update }), [data, loaded, error, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCareer(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCareer must be used inside CareerProvider");
  return ctx;
}

export const STAGES: { value: Stage; label: string }[] = [
  { value: "applied", label: "Applied" },
  { value: "recruiter", label: "Recruiter call" },
  { value: "technical", label: "Technical" },
  { value: "final", label: "Final" },
  { value: "offer", label: "Offer" },
];
export const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.value === s);

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 32) : `${Date.now()}`);
