"use client";

import { UpcomingRow, useUpcoming, type Upcoming } from "@/features/cinema/upcoming";
import { useLocale, useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";

function byMonth(list: Upcoming[]): [string, Upcoming[]][] {
  const groups = new Map<string, Upcoming[]>();
  for (const u of list) groups.set(u.date.slice(0, 7), [...(groups.get(u.date.slice(0, 7)) ?? []), u]);
  return [...groups];
}

export default function CinemaUpcomingPage() {
  const t = useT();
  const locale = useLocale();
  const { soon, justOut, today, isLoading } = useUpcoming();
  const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });

  if (isLoading) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-[#655d51]">
        {t("New seasons and episodes of series you watch, premieres on your watchlist, and new films of franchises you've started. Dates come from TMDB, are refreshed daily and can move.")}
      </p>

      {!soon.length ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`}>{t("Nothing announced yet for what you watch.")}</p>
      ) : (
        byMonth(soon).map(([ym, list]) => (
          <section key={ym} className={card}>
            <h2 className="text-sm font-semibold capitalize text-[#1f1c17]">{month(ym)}</h2>
            <ul className="mt-1 divide-y divide-black/5">
              {list.map((u) => (
                <UpcomingRow key={u.key} u={u} today={today} />
              ))}
            </ul>
          </section>
        ))
      )}

      {justOut.length ? (
        <section className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Out lately in your franchises")}</h2>
          <p className="text-xs text-[#6f675b]">{t("Released in the last two months, not watched yet.")}</p>
          <ul className="mt-1 divide-y divide-black/5">
            {justOut.map((u) => (
              <UpcomingRow key={u.key} u={u} today={today} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
