"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";

/** Fired by the Jobs page once it has marked the vacancies seen, so the badges clear. */
export const JOBS_SEEN_EVENT = "olivia:jobs-seen";

/** New vacancies worth a look since you last opened Jobs (GET /life/jobs/news), for a badge; 0 when unknown. */
export function useJobsNews(): number {
  const { token } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<{ new_interesting: number }>("/life/jobs/news", { token })
      .then((d) => alive && setCount(d.new_interesting))
      .catch(() => {});
    const seen = () => setCount(0);
    window.addEventListener(JOBS_SEEN_EVENT, seen);
    return () => {
      alive = false;
      window.removeEventListener(JOBS_SEEN_EVENT, seen);
    };
  }, [token]);

  return count;
}
