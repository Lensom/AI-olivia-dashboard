"use client";

import { useMemo, useState } from "react";
import { fieldInput, fieldLabel, Modal } from "@/features/cinema/ui";
import { parseUsd } from "@/features/investing/format";
import { investingPrimarySaveActive, investingPrimarySaveDisabled, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useInvesting, type InvestingActivity } from "@/state/investing-store";
import { useT } from "@/lib/i18n";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `<input type="date">` gives YYYY-MM-DD; the trade log stores DD.MM.YYYY. */
function isoToDmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : "";
}

function num(v: string): number {
  return Number(v.replace(",", ".").replace(/\s/g, ""));
}

function round(n: number, digits = 2): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

export function AddActivityDialog({ initialType, onClose }: { initialType: "buy" | "sell"; onClose: () => void }) {
  const tr = useT();
  const { holdings, activities, createActivity, isActivitiesSaving } = useInvesting();

  const [type, setType] = useState<"buy" | "sell">(initialType);
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayIso());
  const [count, setCount] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [isAmountEdited, setAmountEdited] = useState(false);
  const [commission, setCommission] = useState("");
  const [gainsLosses, setGainsLosses] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Known tickers from holdings and past trades, to suggest and autofill name / category. */
  const known = useMemo(() => {
    const map = new Map<string, { name: string; category: string }>();
    for (const a of activities) {
      const t = a.ticker.trim().toUpperCase();
      if (t && !map.has(t)) map.set(t, { name: a.name, category: a.category });
    }
    for (const h of holdings) {
      const t = h.ticker.trim().toUpperCase();
      if (t) map.set(t, { name: h.name || map.get(t)?.name || "", category: map.get(t)?.category || h.industry || "" });
    }
    return map;
  }, [holdings, activities]);

  const computedAmount = Number.isFinite(num(count) * num(price)) ? num(count) * num(price) : 0;
  const shownAmount = isAmountEdited ? amount : computedAmount ? round(computedAmount) : "";

  function onTickerChange(value: string) {
    const t = value.toUpperCase();
    setTicker(t);
    const hit = known.get(t.trim());
    if (hit) {
      if (!name.trim()) setName(hit.name);
      if (!category.trim()) setCategory(hit.category);
    }
  }

  const isSell = type === "sell";
  const canSave = ticker.trim() !== "" && date !== "" && num(count) > 0 && num(price) > 0 && !isActivitiesSaving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    const row: Omit<InvestingActivity, "id"> = {
      type,
      name: name.trim() || ticker.trim(),
      ticker: ticker.trim(),
      category: category.trim(),
      count: num(count),
      price: String(num(price)),
      currency: currency.trim().toUpperCase() || "USD",
      amount: String(parseUsd(shownAmount || "0")),
      gains_losses: isSell ? String(num(gainsLosses) || 0) : "0",
      commission: String(num(commission) || 0),
      date: isoToDmy(date),
    };
    try {
      await createActivity(row);
      onClose();
    } catch (err) {
      setError((err as { message?: string })?.message ?? tr("Couldn’t save the trade."));
    }
  }

  return (
    <Modal title={isSell ? tr("Add sale") : tr("Add purchase")} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3">
        <div className="flex rounded-full border border-black/10 bg-white p-1 self-start">
          {(["buy", "sell"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={[
                "rounded-full px-4 py-1.5 text-xs font-medium transition",
                type === t ? (t === "sell" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800") : "text-[#6f675b] hover:bg-[#faf8f2]",
              ].join(" ")}
            >
              {t === "buy" ? tr("Buy") : tr("Sell")}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={fieldLabel}>
            {tr("Ticker")} *
            <input
              value={ticker}
              onChange={(e) => onTickerChange(e.target.value)}
              list="activity-dialog-tickers"
              className={fieldInput}
              placeholder="AAPL"
              autoFocus
              required
            />
            <datalist id="activity-dialog-tickers">
              {[...known.entries()].map(([t, v]) => (
                <option key={t} value={t}>
                  {v.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className={`${fieldLabel} sm:col-span-2`}>
            {tr("Name")}
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldInput} placeholder={tr("Company")} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={fieldLabel}>
            {tr("Category")}
            <input value={category} onChange={(e) => setCategory(e.target.value)} className={fieldInput} placeholder="ETF / Banks / ..." />
          </label>
          <label className={fieldLabel}>
            {tr("Date")} *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldInput} required />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className={fieldLabel}>
            {tr("Shares")} *
            <input value={count} onChange={(e) => setCount(e.target.value)} className={fieldInput} inputMode="decimal" placeholder="0" required />
          </label>
          <label className={fieldLabel}>
            {tr("Price")} *
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={fieldInput} inputMode="decimal" placeholder="0" required />
          </label>
          <label className={fieldLabel}>
            {tr("Currency")}
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={fieldInput} placeholder="USD" />
          </label>
          <label className={fieldLabel}>
            {tr("Amount")}
            <input
              value={shownAmount}
              onChange={(e) => {
                setAmountEdited(true);
                setAmount(e.target.value);
              }}
              className={fieldInput}
              inputMode="decimal"
              placeholder="0"
              title={tr("Shares × price unless you type your own")}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            {tr("Commission")}
            <input value={commission} onChange={(e) => setCommission(e.target.value)} className={fieldInput} inputMode="decimal" placeholder="0" />
          </label>
          {isSell ? (
            <label className={fieldLabel}>
              {tr("Gains/Losses")}
              <input value={gainsLosses} onChange={(e) => setGainsLosses(e.target.value)} className={fieldInput} inputMode="decimal" placeholder="0" />
            </label>
          ) : null}
        </div>

        <p className="text-[11px] text-[#8f8676]">{tr("Amounts are in the trade’s currency; USD and the FX rate are calculated on save.")}</p>
        {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={investingToolbarBtn}>
            {tr("Cancel")}
          </button>
          <button type="submit" disabled={!canSave} className={["transition", canSave ? investingPrimarySaveActive : investingPrimarySaveDisabled].join(" ")}>
            {isActivitiesSaving ? tr("Saving…") : tr("Save trade")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
