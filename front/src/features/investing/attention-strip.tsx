"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { attentionItems, type AttentionKind } from "@/features/investing/attention";
import { parseCryptoAmount, yahooCryptoPair } from "@/features/investing/crypto-format";
import { parseUsd } from "@/features/investing/format";
import { feeBreakdown, xirrFromRefills } from "@/features/investing/funding-stats";
import { accountUsd, totalSums, type TotalAccount } from "@/features/investing/total-stats";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";
import { DEFAULT_RULES, useBroker, type AttentionRules } from "@/state/broker-store";
import { useInvesting } from "@/state/investing-store";

type TotalDoc = {
  accounts: TotalAccount[];
  goals: Record<string, number>;
  months: { month: string }[];
  rate_overrides: Record<string, number>;
  updated_at: string | null;
};

const KIND_STYLE: Record<AttentionKind, { icon: string; label: string; cls: string }> = {
  warn: { icon: "⚠", label: "Rule", cls: "bg-amber-50 text-amber-900 border-amber-200" },
  opportunity: { icon: "★", label: "Opportunity", cls: "bg-emerald-50 text-emerald-900 border-emerald-200" },
  todo: { icon: "○", label: "To do", cls: "bg-sky-50 text-sky-900 border-sky-200" },
};

const RULE_FIELDS: { key: keyof AttentionRules; label: string; suffix: string }[] = [
  { key: "max_fees_pct", label: "Max fees, % of deposits", suffix: "%" },
  { key: "min_annual_return_pct", label: "Min annual return", suffix: "%" },
  { key: "etf_min_pct", label: "ETF share from", suffix: "%" },
  { key: "etf_max_pct", label: "ETF share to", suffix: "%" },
  { key: "drift_pp", label: "Flag drift from", suffix: "pp" },
  { key: "max_position_pct", label: "Max single position", suffix: "%" },
  { key: "max_cash_pct", label: "Max idle broker cash", suffix: "%" },
];

/** What needs your attention across Investing: broken rules, buy opportunities, and missing monthly steps. */
export function AttentionStrip() {
  const { token } = useAuth();
  const { holdings, pickingRows, refills, activitiesSummary, operatingExpensesUsd } = useInvesting();
  const { cash, cashUsd, dividends, rules, saveRules, isLoaded } = useBroker();
  const [total, setTotal] = useState<TotalDoc | null | undefined>(undefined); // undefined = loading
  const [cryptoValue, setCryptoValue] = useState(0);
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const [nowMs] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AttentionRules>(rules);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<TotalDoc>("/investing/total", { token })
      .then((t) => setTotal(t.updated_at ? t : null))
      .catch(() => setTotal(null));
    apiFetch<{ to_usd: Record<string, number> }>("/investing/rates", { token })
      .then((r) => setRates({ USD: 1, ...r.to_usd }))
      .catch(() => {});
    // Crypto value for the net-worth mix (the crypto store only lives in the Crypto section).
    apiFetch<{ holdings: { symbol: string; quantity: string }[] }>("/investing/crypto", { token })
      .then(async (c) => {
        const pairs = [...new Set(c.holdings.map((h) => yahooCryptoPair(h.symbol)).filter(Boolean))];
        if (!pairs.length) return;
        const q = await apiFetch<{ prices: Record<string, number> }>(
          `/investing/quotes?tickers=${encodeURIComponent(pairs.join(","))}`,
          { token },
        );
        setCryptoValue(
          c.holdings.reduce((a, h) => a + (q.prices[yahooCryptoPair(h.symbol)] ?? 0) * parseCryptoAmount(h.quantity), 0),
        );
      })
      .catch(() => {});
  }, [token]);

  const items = useMemo(() => {
    const holdingsValue = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const topped = refills.reduce((a, r) => a + parseUsd(r.amount), 0);
    const fees = feeBreakdown(refills, activitiesSummary, operatingExpensesUsd).total;
    const xirr = xirrFromRefills(refills, holdingsValue + cashUsd, nowMs);
    const month = new Date(nowMs).toISOString().slice(0, 7);

    let totalInput = null;
    if (total) {
      const rateFor = (c: string) => {
        const cur = c.trim().toUpperCase() || "USD";
        return total.rate_overrides[cur] ?? rates[cur] ?? null;
      };
      const sums = totalSums(
        total.accounts.map((a) => ({
          category: a.category,
          usd: accountUsd(a, { stocks: holdingsValue + cashUsd, crypto: cryptoValue }, rateFor).usd,
        })),
      );
      totalInput = {
        goals: total.goals,
        mix:
          sums.assets > 0 && cryptoValue > 0
            ? {
                stocks: (sums.by.stocks / sums.assets) * 100,
                savings: (sums.by.savings / sums.assets) * 100,
                crypto: (sums.by.crypto / sums.assets) * 100,
              }
            : null,
        monthRecorded: total.months.some((m) => m.month === month),
        monthLabel: new Date(nowMs).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      };
    }

    return attentionItems({
      rules,
      holdings,
      pickingRows,
      cashUsd,
      hasCashEntry: cash.length > 0,
      hasDividends: dividends.length > 0,
      feesPct: topped > 0 ? (fees / topped) * 100 : null,
      xirrPct: xirr == null ? null : xirr * 100,
      total: totalInput,
    });
  }, [holdings, refills, activitiesSummary, operatingExpensesUsd, cashUsd, cash, dividends, pickingRows, rules, total, rates, cryptoValue, nowMs]);

  const loading = !isLoaded || total === undefined || holdings.length === 0;
  const visible = showAll ? items : items.slice(0, 6);
  const counts = items.reduce<Record<AttentionKind, number>>((a, i) => ({ ...a, [i.kind]: a[i.kind] + 1 }), {
    warn: 0,
    opportunity: 0,
    todo: 0,
  });

  async function onSaveRules() {
    setSaving(true);
    try {
      await saveRules(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[#1f1c17]">
          Needs attention{" "}
          {!loading ? (
            <span className="font-normal text-[#8f8676]">
              · {counts.warn} rule{counts.warn === 1 ? "" : "s"} · {counts.opportunity} opportunit{counts.opportunity === 1 ? "y" : "ies"} ·{" "}
              {counts.todo} to do
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => {
            setDraft(rules);
            setEditing((v) => !v);
          }}
          className="text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2 hover:text-[#1f1c17]"
        >
          {editing ? "Close thresholds" : "Thresholds"}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 rounded-xl bg-[#faf8f2] p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RULE_FIELDS.map((f) => (
              <label key={f.key} className="text-[11px] text-[#6f675b]">
                {f.label}
                <span className="mt-1 flex items-center gap-1">
                  <input
                    value={String(draft[f.key])}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value.replace(",", ".")) || 0 }))}
                    className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm tabular-nums text-[#2f2922] outline-none focus:border-black/20"
                    inputMode="decimal"
                  />
                  <span className="text-xs text-[#8f8676]">{f.suffix}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => void onSaveRules()} disabled={saving} className={investingPrimarySaveActive}>
              {saving ? "Saving…" : "Save thresholds"}
            </button>
            <button type="button" onClick={() => setDraft(DEFAULT_RULES)} className={investingToolbarBtn}>
              Reset to defaults
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-3 text-sm text-[#8f8676]">Checking your rules…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-800">✓ All clear — every rule is within its limit and this month is recorded.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {visible.map((i) => {
            const k = KIND_STYLE[i.kind];
            return (
              <li key={i.id}>
                <Link href={i.href} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition hover:brightness-[0.98] ${k.cls}`}>
                  <span aria-hidden className="mt-px">
                    {k.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{k.label}: </span>
                    <span className="font-medium">{i.title}</span>
                    {i.detail ? <span className="block text-xs opacity-80">{i.detail}</span> : null}
                  </span>
                  <span aria-hidden className="text-xs opacity-60">
                    →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && items.length > 6 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2">
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </button>
      ) : null}
    </section>
  );
}
