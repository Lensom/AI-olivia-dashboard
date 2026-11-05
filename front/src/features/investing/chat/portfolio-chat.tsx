"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SparkIcon } from "@/features/investing/watchlist/ai-analysis";
import { apiFetch, type ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

type Message = { role: "user" | "assistant"; content: string };
type ChatResponse = { reply: string; model: string; stale_data: boolean };

const MAX_LENGTH = 4000;

/** Survives moving between pages and reloading the tab, and ends with the tab. Per account, never shared between them. */
function storageKey(userId: number): string {
  return `olivia.investing.chat.v1.${userId}`;
}

function loadMessages(userId: number): Message[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Message[]) : [];
  } catch {
    return [];
  }
}

function saveMessages(userId: number, messages: Message[]) {
  try {
    window.sessionStorage.setItem(storageKey(userId), JSON.stringify(messages));
  } catch {
    // Storage blocked or full: the chat still works until the page closes.
  }
}

function tickerFromPath(pathname: string): string | null {
  const match = /^\/investing\/stock\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]).toUpperCase() : null;
}

/** Answers are asked to be plain text; this catches the markdown that slips through anyway. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\*\s+/gm, "- ");
}

/** Chat button, bottom right on the Investing pages, and the drawer it opens. The server adds the account to each question. */
export function PortfolioChat() {
  const { token, user } = useAuth();
  const t = useT();
  const pathname = usePathname();
  const ticker = tickerFromPath(pathname);
  const [open, setOpen] = useState(false);
  // Keyed by account, so logging into another one never shows the previous conversation.
  const [chat, setChat] = useState<{ userId: number; messages: Message[] } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = user && chat?.userId === user.id ? chat.messages : [];
  const count = messages.length;

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [open, count, busy, error]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!token || !user) return null;
  const userId = user.id;

  function close() {
    setOpen(false);
    // The button is back once this render is done.
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function show() {
    if (chat?.userId !== userId) setChat({ userId, messages: loadMessages(userId) });
    setOpen(true);
  }

  function store(next: Message[]) {
    setChat({ userId, messages: next });
    saveMessages(userId, next);
  }

  async function ask(history: Message[]) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<ChatResponse>("/investing/chat", {
        method: "POST",
        token,
        body: JSON.stringify({ messages: history, ticker }),
      });
      setStale(res.stale_data);
      store([...history, { role: "assistant", content: res.reply }]);
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 0 ? t("Can’t reach the server") : e.message || t("Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: Message[] = [...messages, { role: "user", content }];
    store(history);
    setInput("");
    void ask(history);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  function reset() {
    store([]);
    setError(null);
    setStale(false);
    inputRef.current?.focus();
  }

  const suggestions = [
    ...(ticker ? [t("Should I buy {ticker} now?", { ticker })] : []),
    t("What should I buy with my cash?"),
    t("Where is my biggest risk?"),
    t("Which positions overlap?"),
  ];
  const failedLast = !!error && messages[count - 1]?.role === "user";

  if (!open) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={show}
        aria-label={t("Open AI chat")}
        title={t("Open AI chat")}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#1f1c17] text-[#f8f4eb] shadow-[0_8px_24px_rgba(18,16,13,0.28)] transition hover:bg-[#2c2923] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2a78d6] focus-visible:ring-offset-2 sm:right-6"
      >
        <SparkIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={t("AI chat")}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-black/10 bg-[#fbf9f4] shadow-[-12px_0_40px_rgba(18,16,13,0.14)] sm:w-[420px]"
    >
      <header className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
        <SparkIcon className="h-4 w-4 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("AI chat")}</h2>
          <p className="truncate text-[11px] text-[#8f8676]">
            {ticker ? t("Sees your portfolio and {ticker}", { ticker }) : t("Sees your portfolio")}
          </p>
        </div>
        {count ? (
          <button type="button" onClick={reset} disabled={busy} className="rounded-full px-2.5 py-1 text-xs font-medium text-[#6f675b] hover:bg-black/5 disabled:opacity-50">
            {t("New chat")}
          </button>
        ) : null}
        <button type="button" onClick={close} aria-label={t("Close chat")} className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-[#6f675b] hover:bg-black/5">
          <span aria-hidden>×</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
        {stale ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900" role="status">
            <span aria-hidden>⚠ </span>
            {t("Freedom24 didn’t answer, so your cash and positions here come from the saved copy and may be out of date.")}
          </p>
        ) : null}

        {count === 0 ? (
          <div>
            <p className="text-sm leading-relaxed text-[#3b352d]">
              {t("Ask anything about your investments. I see your holdings, cash, targets, watchlist and notes.")}
            </p>
            <div className="mt-3 flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-2xl border border-black/10 bg-white px-3 py-1.5 text-left text-xs font-medium text-[#3b352d] hover:bg-[#f4efe4]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-8 whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[#1f1c17] px-3.5 py-2 text-sm leading-relaxed text-[#f8f4eb]">
              {m.content}
            </p>
          ) : (
            <p key={i} className="mr-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#2f2922]">
              {plain(m.content)}
            </p>
          ),
        )}

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-[#6f675b]" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
            {t("Looking through your portfolio…")}
          </p>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
            <p>{error}</p>
            {failedLast ? (
              <button type="button" onClick={() => void ask(messages)} className="mt-1 font-semibold underline underline-offset-2">
                {t("Try again")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-black/5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-1.5 focus-within:border-black/25">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={MAX_LENGTH}
            aria-label={t("Your question")}
            placeholder={t("Ask about your portfolio…")}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1 text-base text-[#1f1c17] outline-none placeholder:text-[#b0a79a] sm:text-sm"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label={t("Send")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1f1c17] text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-30"
          >
            <span aria-hidden>↑</span>
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-[#8f8676]">{t("AI-generated, not financial advice.")}</p>
      </form>
    </aside>
  );
}
