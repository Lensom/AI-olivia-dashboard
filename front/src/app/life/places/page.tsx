"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { ALL_CODES, WORLD_COUNTRIES, codesOfLocations, countryName } from "@/features/life/places/countries";
import { PlacesMap, type MapPlace } from "@/features/life/places/map";
import {
  SORTS,
  countriesOf,
  emptyPlace,
  isWebLink,
  newId,
  norm,
  type Place,
  type PlaceCategory,
  type Places,
  type PlacesResponse,
  type Sort,
  type StatusFilter,
  type Suggestion,
  type View,
  type WikiInfo,
} from "@/features/life/places/types";
import { apiFetch, type ApiError } from "@/lib/api";
import { filterSearch, filterSelect } from "@/lib/filter-classes";
import { useLang, useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const field = "min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25";
const chip = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`;

type Edit = (change: (p: Places) => Places) => void;
type Row = { place: Place; category: PlaceCategory };
type Editing = { place: Place; categoryId: string; isNew: boolean };

const COLLAPSED_KEY = "olivia.places.collapsed.v1";

/** Categories you folded, remembered in this browser (a convenience: everything works without it). */
function readCollapsed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[]) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered; folding still works.
  }
}

/** The picture for a place: your own link first, then Wikipedia's; "" when there's none (yet). */
const pictureOf = (p: { image?: string; wiki: string }, wiki: Record<string, WikiInfo>) => p.image || wiki[p.wiki]?.image || "";

function Picture({ src, emoji, className = "" }: { src: string; emoji: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-[#efe6d4] to-[#d9cfbd] text-5xl ${className}`} aria-hidden>
        {emoji || "📍"}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- Wikipedia pictures, as the posters elsewhere
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className={`object-cover ${className}`} />;
}

function PlaceCard({ row, wiki, highlighted, onToggle, onEdit }: { row: Row; wiki: Record<string, WikiInfo>; highlighted: boolean; onToggle: () => void; onEdit: () => void }) {
  const t = useT();
  const [lang] = useLang();
  const { place, category } = row;
  const info = wiki[place.wiki];
  // Wikipedia's one-liner and article in the page's language: the Ukrainian ones on the Ukrainian page.
  const blurb = place.note || (lang === "uk" ? info?.uk_description : info?.description);
  const article = lang === "uk" ? info?.uk_url || info?.url : info?.url;
  return (
    <article
      id={`place-${place.id}`}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_8px_30px_rgba(18,16,13,0.06)] transition ${highlighted ? "border-amber-400 ring-4 ring-amber-300/60" : place.visited ? "border-emerald-200" : "border-black/5"}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Picture src={pictureOf(place, wiki)} emoji={category.emoji} className="h-full w-full transition duration-500 group-hover:scale-[1.04]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
        <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-xs shadow-sm" title={category.title}>
          {category.emoji}
          {place.group ? <span className="ml-1 text-[11px] font-medium text-[#3b352d]">{place.group}</span> : null}
        </span>
        {place.visited ? (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">✓ {t("Visited")}</span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          {place.location ? <p className="text-[11px] font-medium opacity-90">📍 {place.location}</p> : null}
          <h3 className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug [text-shadow:0_1px_8px_rgba(0,0,0,0.4)]">{place.name}</h3>
        </div>
      </div>
      {blurb ? <p className="line-clamp-2 px-3 pt-2.5 text-xs text-[#6f675b]">{blurb}</p> : null}
      <div className="mt-auto flex items-center gap-1.5 p-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={place.visited}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${place.visited ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-[#f1ece2] text-[#3b352d] hover:bg-[#e7dfcf]"}`}
        >
          {place.visited ? `✓ ${t("Visited")}` : t("Mark as visited")}
        </button>
        {article ? (
          <a href={article} target="_blank" rel="noreferrer" className="ml-auto rounded px-1.5 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]">
            {t("Wikipedia")} ↗
          </a>
        ) : null}
        <button type="button" onClick={onEdit} className={`${article ? "" : "ml-auto "}rounded px-1.5 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]`}>
          {t("Edit")}
        </button>
      </div>
    </article>
  );
}

type IdeasState = { fromAi: boolean; at: string | null; busy: boolean; error: string | null };

function Suggestions({
  items,
  categories,
  wiki,
  ideas,
  onAdd,
  onDismiss,
  onAskAi,
}: {
  items: Suggestion[];
  categories: PlaceCategory[];
  wiki: Record<string, WikiInfo>;
  ideas: IdeasState;
  onAdd: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onAskAi: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <section aria-label={t("Maybe add to the list")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-[#1f1c17]">✨ {t("Maybe add to the list")}</h2>
        {ideas.fromAi && ideas.at ? (
          <span className="text-xs text-[#8f8676]">
            {t("Picked by AI for your list · {date}", { date: new Date(ideas.at).toLocaleDateString(locale, { day: "numeric", month: "short" }) })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onAskAi}
          disabled={ideas.busy}
          className="ml-auto rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-60"
        >
          {ideas.busy ? t("AI is thinking…") : ideas.fromAi ? `✨ ${t("New ideas from AI")}` : `✨ ${t("Ideas from AI for my list")}`}
        </button>
      </div>
      {ideas.error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          {t(ideas.error)}
        </p>
      ) : null}
      {!items.length ? <p className="text-xs text-[#8f8676]">{t("No ideas left: ask AI for new ones.")}</p> : null}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {items.map((s) => {
          const emoji = categories.find((c) => c.id === s.category)?.emoji ?? "📍";
          return (
            <div key={s.id} className="relative w-48 shrink-0 snap-start overflow-hidden rounded-xl border border-dashed border-black/15 bg-white/80">
              <Picture src={pictureOf(s, wiki)} emoji={emoji} className="h-24 w-full opacity-90" />
              <button
                type="button"
                onClick={() => onDismiss(s)}
                aria-label={t("Not interested: {name}", { name: s.name })}
                title={t("Not interested")}
                className="absolute right-1.5 top-1.5 rounded-full bg-white/90 px-1.5 text-xs text-[#6f675b] shadow-sm hover:text-[#1f1c17]"
              >
                ✕
              </button>
              <div className="space-y-1 p-2.5">
                <p className="text-[11px] text-[#8f8676]">
                  {emoji} {s.location}
                </p>
                <p className="line-clamp-2 min-h-[2.5em] text-xs font-semibold leading-snug text-[#1f1c17]">{s.name}</p>
                {s.reason ? (
                  <p className="line-clamp-3 text-[11px] leading-snug text-[#6f675b]" title={s.reason}>
                    {s.reason}
                  </p>
                ) : null}
                <button type="button" onClick={() => onAdd(s)} className="w-full rounded-full bg-[#1f1c17] py-1 text-xs font-medium text-[#f8f4eb] hover:bg-black">
                  + {t("Add to plans")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Editor({ editing, categories, onSave, onDelete, onClose }: { editing: Editing; categories: PlaceCategory[]; onSave: (e: Editing) => void; onDelete: () => void; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(editing);
  const first = useRef<HTMLInputElement>(null);
  const set = (change: Partial<Place>) => setDraft((d) => ({ ...d, place: { ...d.place, ...change } }));
  const badImage = draft.place.image.trim() !== "" && !isWebLink(draft.place.image);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const label = (text: string, input: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[#6f675b]">{text}</span>
      {input}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={editing.isNew ? t("Add a place") : t("Edit place")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.place.name.trim() || badImage) return;
          onSave({ ...draft, place: { ...draft.place, name: draft.place.name.trim(), location: draft.place.location.trim(), wiki: draft.place.wiki.trim(), image: draft.place.image.trim() } });
        }}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-[#1f1c17]">{editing.isNew ? t("Add a place") : t("Edit place")}</h2>
        {label(t("Name"), <input ref={first} required maxLength={300} value={draft.place.name} onChange={(e) => set({ name: e.target.value })} className={`${field} w-full`} />)}
        {label(t("Location"), <input maxLength={200} value={draft.place.location} onChange={(e) => set({ location: e.target.value })} placeholder={t("City, country")} className={`${field} w-full`} />)}
        <div className="grid grid-cols-2 gap-2">
          {label(
            t("Category"),
            <select value={draft.categoryId} onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))} className={`${field} w-full`}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.title}
                </option>
              ))}
            </select>,
          )}
          {label(t("Group (optional)"), <input maxLength={100} value={draft.place.group} onChange={(e) => set({ group: e.target.value })} className={`${field} w-full`} />)}
        </div>
        {label(t("Wikipedia article in English, for the picture"), <input maxLength={200} value={draft.place.wiki} onChange={(e) => set({ wiki: e.target.value })} placeholder="Eiffel Tower" className={`${field} w-full`} />)}
        {label(
          t("Your own picture link (optional)"),
          <input maxLength={2000} value={draft.place.image} onChange={(e) => set({ image: e.target.value })} placeholder="https://…" aria-invalid={badImage} className={`${field} w-full ${badImage ? "border-rose-400" : ""}`} />,
        )}
        {badImage ? <p className="text-xs text-rose-700">{t("A link must start with http:// or https://")}</p> : null}
        {label(t("Note"), <textarea maxLength={2000} rows={2} value={draft.place.note} onChange={(e) => set({ note: e.target.value })} className={`${field} w-full`} />)}
        <label className="flex items-center gap-2 text-sm text-[#3b352d]">
          <input type="checkbox" checked={draft.place.visited} onChange={(e) => set({ visited: e.target.checked })} />
          {t("Visited")}
        </label>
        <div className="flex items-center gap-2 pt-1">
          {editing.isNew ? null : (
            <button type="button" onClick={onDelete} className="rounded-full px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
              {t("Delete")}
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button type="submit" disabled={!draft.place.name.trim() || badImage} className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb] disabled:opacity-40">
            {t("Save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function PlacesPage() {
  const t = useT();
  const locale = useLocale();
  const { token } = useAuth();
  const [lang] = useLang();
  const [data, setData] = useState<Places>({ categories: [], dismissed: [], countries: [] });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ideasState, setIdeasState] = useState<IdeasState>({ fromAi: false, at: null, busy: false, error: null });
  const [view, setView] = useState<View>("cards");
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [wiki, setWiki] = useState<Record<string, WikiInfo>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("all");
  const [country, setCountry] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("category");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Read lazily: this page renders only after login, in the browser.
  const [collapsed, setCollapsed] = useState<string[]>(() => (typeof window === "undefined" ? [] : readCollapsed()));
  const latest = useRef<Places>(data);

  const fold = (next: string[]) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<PlacesResponse>("/life/places", { token })
      .then((d) => {
        if (!alive) return;
        latest.current = { categories: d.categories, dismissed: d.dismissed, countries: d.countries ?? [] };
        setData(latest.current);
        setSuggestions(d.suggestions);
        setIdeasState((s) => ({ ...s, fromAi: d.ideas_from_ai, at: d.ideas_at }));
        // Pictures come after the list, so the page doesn't wait for Wikipedia.
        const titles = [...d.categories.flatMap((c) => c.items.map((p) => p.wiki)), ...d.suggestions.map((s) => s.wiki)].filter(Boolean);
        return apiFetch<Record<string, WikiInfo>>("/life/places/images", { token, method: "POST", body: JSON.stringify({ titles }) }).then((w) => alive && setWiki(w));
      })
      .catch(() => alive && setError("Could not load your places. Is the backend running?"))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [token]);

  /** Applies a change right away and saves it; puts the list back if saving fails. */
  const edit: Edit = (change) => {
    const prev = latest.current;
    const next = change(prev);
    latest.current = next;
    setData(next);
    apiFetch("/life/places", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) })
      .then(() => setError(null))
      .catch(() => {
        if (latest.current === next) {
          latest.current = prev;
          setData(prev);
        }
        setError("Could not save — the change was undone.");
      });
  };

  /** Pictures for places added since the page loaded, or for new ideas. */
  function loadPictures(titles: string[]) {
    const wanted = titles.filter((title) => title && !wiki[title]);
    if (!wanted.length || !token) return;
    apiFetch<Record<string, WikiInfo>>("/life/places/images", { token, method: "POST", body: JSON.stringify({ titles: wanted }) })
      .then((w) => setWiki((prev) => ({ ...prev, ...w })))
      .catch(() => {});
  }

  function askAi() {
    if (!token) return;
    setIdeasState((s) => ({ ...s, busy: true, error: null }));
    apiFetch<PlacesResponse>(`/life/places/ideas?lang=${lang}`, { token, method: "POST" })
      .then((d) => {
        setSuggestions(d.suggestions);
        setIdeasState({ fromAi: d.ideas_from_ai, at: d.ideas_at, busy: false, error: null });
        loadPictures(d.suggestions.map((s) => s.wiki));
      })
      .catch((e: ApiError) => {
        const message = e.status === 429 ? "Gemini quota is used up — try again later" : e.status === 503 ? "AI is not set up on the server." : "AI couldn't come up with ideas — try again.";
        setIdeasState((s) => ({ ...s, busy: false, error: message }));
      });
  }

  const rows: Row[] = useMemo(() => data.categories.flatMap((c) => c.items.map((place) => ({ place, category: c }))), [data]);
  const visited = rows.filter((r) => r.place.visited);
  // Your own list of countries; until you make one, the ones the visited places are in.
  const fromPlaces = useMemo(() => codesOfLocations(rows.filter((r) => r.place.visited).map((r) => r.place.location)), [rows]);
  const myCountries = data.countries.length ? data.countries : fromPlaces;
  const editPlace = useCallback(
    (id: string) => {
      const r = rows.find((x) => x.place.id === id);
      if (r) setEditing({ place: r.place, categoryId: r.category.id, isNew: false });
    },
    [rows],
  );
  const countries = useMemo(() => [...new Set(rows.flatMap((r) => countriesOf(r.place.location)))].sort((a, b) => a.localeCompare(b, locale)), [rows, locale]);
  const onList = new Set(rows.map((r) => r.place.wiki).filter(Boolean));
  const ideas = suggestions.filter((s) => !data.dismissed.includes(s.id) && !onList.has(s.wiki));

  const shown = useMemo(() => {
    const q = norm(query.trim());
    const kept = rows.filter(
      ({ place, category: c }) =>
        (status === "all" || (status === "visited") === place.visited) &&
        (category === "all" || c.id === category) &&
        (country === "all" || countriesOf(place.location).includes(country) || place.location.includes(country)) &&
        (!q || norm(`${place.name} ${place.location} ${place.group} ${place.note}`).includes(q)),
    );
    const byName = (a: Row, b: Row) => a.place.name.localeCompare(b.place.name, locale);
    if (sort === "name") return [...kept].sort(byName);
    if (sort === "location") return [...kept].sort((a, b) => a.place.location.localeCompare(b.place.location, locale) || byName(a, b));
    if (sort === "visited" || sort === "planned") {
      const first = sort === "visited";
      return [...kept].sort((a, b) => Number(b.place.visited === first) - Number(a.place.visited === first));
    }
    return kept;
  }, [rows, status, category, country, query, sort, locale]);

  const groups = useMemo(
    () => (sort === "category" ? data.categories.map((c) => ({ category: c, rows: shown.filter((r) => r.category.id === c.id) })).filter((g) => g.rows.length) : null),
    [sort, data.categories, shown],
  );

  // The map shows what the filters let through, wherever Wikipedia knows the coordinates.
  const mapPlaces: MapPlace[] = useMemo(
    () =>
      shown.flatMap(({ place, category: c }) => {
        const info = wiki[place.wiki];
        if (info?.lat == null || info?.lon == null) return [];
        return [{ id: place.id, name: place.name, location: place.location, visited: place.visited, lat: info.lat, lon: info.lon, image: pictureOf(place, wiki), emoji: c.emoji }];
      }),
    [shown, wiki],
  );
  const mapLabels = useMemo(() => ({ visited: t("Visited"), planned: t("Planned"), edit: t("Edit") }), [t]);

  const toggle = (id: string) =>
    edit((p) => ({ ...p, categories: p.categories.map((c) => ({ ...c, items: c.items.map((x) => (x.id === id ? { ...x, visited: !x.visited } : x)) })) }));

  function save(e: Editing) {
    edit((p) => {
      const without = p.categories.map((c) => ({ ...c, items: c.items.filter((x) => x.id !== e.place.id) }));
      return {
        ...p,
        categories: without.map((c) => {
          if (c.id !== e.categoryId) return c;
          // An edited place keeps its spot when it stays in its category; a new or moved one goes last.
          const old = p.categories.find((x) => x.id === c.id)?.items.findIndex((x) => x.id === e.place.id) ?? -1;
          const items = [...c.items];
          items.splice(old >= 0 ? old : items.length, 0, e.place);
          return { ...c, items };
        }),
      };
    });
    loadPictures([e.place.wiki]);
    setEditing(null);
  }

  function remove(id: string) {
    edit((p) => ({ ...p, categories: p.categories.map((c) => ({ ...c, items: c.items.filter((x) => x.id !== id) })) }));
    setEditing(null);
  }

  function addIdea(s: Suggestion) {
    const place: Place = { ...emptyPlace(), id: newId(), name: s.name, location: s.location, wiki: s.wiki };
    edit((p) => ({ ...p, categories: p.categories.map((c) => (c.id === s.category ? { ...c, items: [...c.items, place] } : c)) }));
  }

  /** Picks a planned place among those shown, and brings it into view. */
  function surprise() {
    const planned = shown.filter((r) => !r.place.visited);
    if (!planned.length) return;
    const chosen = planned[Math.floor(Math.random() * planned.length)];
    const pick = chosen.place.id;
    if (collapsed.includes(chosen.category.id)) fold(collapsed.filter((id) => id !== chosen.category.id));
    setHighlight(pick);
    requestAnimationFrame(() => document.getElementById(`place-${pick}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const percent = rows.length ? Math.round((visited.length / rows.length) * 100) : 0;
  const filtering = status !== "all" || category !== "all" || country !== "all" || query.trim() !== "";
  const card = (r: Row) => (
    <PlaceCard
      key={r.place.id}
      row={r}
      wiki={wiki}
      highlighted={highlight === r.place.id}
      onToggle={() => toggle(r.place.id)}
      onEdit={() => setEditing({ place: r.place, categoryId: r.category.id, isNew: false })}
    />
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        {/* basis-64: on a phone the buttons move below instead of squeezing the title into a narrow column. */}
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Must visit")}</h1>
          <p className="mt-1 text-sm text-[#6f675b]">{t("Places and events: where you've been, and where you're going next.")}</p>
        </div>
        {loaded && data.categories.length ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={surprise} className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm font-medium text-[#3b352d] hover:bg-[#faf8f2]">
              🎲 {t("Where next?")}
            </button>
            <button
              type="button"
              onClick={() => setEditing({ place: emptyPlace(), categoryId: category !== "all" ? category : data.categories[0].id, isNew: true })}
              className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-sm font-medium text-[#f8f4eb] hover:bg-black"
            >
              + {t("Add a place")}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">
          {t(error)}
        </p>
      ) : null}

      {!loaded ? (
        <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
      ) : !data.categories.length ? null : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
              <p className="text-xs font-medium text-[#8f8676]">{t("Visited")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">
                {visited.length} <span className="text-base font-normal text-[#8f8676]">/ {rows.length}</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#efe9dc]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("Visited")}>
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
              <div className="flex items-baseline gap-2">
                <p className="text-xs font-medium text-[#8f8676]">{data.countries.length ? t("My countries") : t("Countries on this list")}</p>
                <button type="button" onClick={() => setCountriesOpen(true)} className="ml-auto rounded px-1.5 text-xs text-[#8f8676] underline-offset-2 hover:text-[#1f1c17] hover:underline">
                  {data.countries.length ? t("Edit") : t("Mark all my countries")}
                </button>
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">
                {myCountries.length} <span className="text-base font-normal text-[#8f8676]">/ {WORLD_COUNTRIES}</span>
              </p>
              <p className="mt-1 truncate text-xs text-[#8f8676]" title={myCountries.map((c) => countryName(c, locale)).join(", ")}>
                {myCountries.map((c) => countryName(c, locale)).join(", ")}
              </p>
            </div>
            <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
              <p className="text-xs font-medium text-[#8f8676]">{t("Planned")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">{rows.length - visited.length}</p>
              <p className="mt-1 text-xs text-[#8f8676]">{t("{n}% of the list done", { n: percent })}</p>
            </div>
          </section>

          <Suggestions
            items={ideas}
            categories={data.categories}
            wiki={wiki}
            ideas={ideasState}
            onAdd={addIdea}
            onDismiss={(s) => edit((p) => ({ ...p, dismissed: [...p.dismissed, s.id] }))}
            onAskAi={askAi}
          />

          <section className="space-y-2.5" aria-label={t("Filters")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={t("Status")}>
                {(
                  [
                    ["all", t("All"), rows.length],
                    ["visited", t("Visited"), visited.length],
                    ["planned", t("Planned"), rows.length - visited.length],
                  ] as const
                ).map(([value, label, n]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatus(value)}
                    aria-pressed={status === value}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${status === value ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
                  >
                    {label} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
              </span>
              <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={t("View")}>
                {(
                  [
                    ["cards", `▦ ${t("Cards")}`],
                    ["map", `🗺 ${t("Map")}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setView(value)}
                    aria-pressed={view === value}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${view === value ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
                  >
                    {label}
                  </button>
                ))}
              </span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t("Country")} className={`${filterSelect} flex-1 basis-36 sm:flex-none sm:basis-auto`}>
                <option value="all">{t("All countries")}</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort")} className={filterSelect}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.label)}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search places…")}
                aria-label={t("Search places…")}
                className={filterSearch}
              />
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={t("Category")}>
              <button type="button" onClick={() => setCategory("all")} aria-pressed={category === "all"} className={chip(category === "all")}>
                {t("All")}
              </button>
              {data.categories.map((c) => {
                const done = c.items.filter((x) => x.visited).length;
                return (
                  <button key={c.id} type="button" onClick={() => setCategory(category === c.id ? "all" : c.id)} aria-pressed={category === c.id} className={chip(category === c.id)}>
                    {c.emoji} {c.title}
                    <span className="tabular-nums opacity-70">
                      {done}/{c.items.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {view === "map" ? (
            <div className="space-y-2">
              <PlacesMap places={mapPlaces} countries={myCountries} labels={mapLabels} onEdit={editPlace} />
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6f675b]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden /> {t("Visited")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden /> {t("Planned")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded-sm bg-emerald-500/30 ring-1 ring-emerald-500/50" aria-hidden /> {t("Countries I've been to")}
                </span>
                {shown.length > mapPlaces.length ? (
                  <span className="text-[#8f8676]">{t("Not on the map: {n} (paintings, events, aurora…)", { n: shown.length - mapPlaces.length })}</span>
                ) : null}
              </p>
            </div>
          ) : !shown.length ? (
            <p className="text-sm text-[#8f8676]">{filtering ? t("Nothing matches these filters.") : t("Nothing here yet.")}</p>
          ) : groups ? (
            <div className="space-y-6">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => fold(groups.every((g) => collapsed.includes(g.category.id)) ? [] : data.categories.map((c) => c.id))}
                  className="rounded px-2 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]"
                >
                  {groups.every((g) => collapsed.includes(g.category.id)) ? t("Expand all") : t("Collapse all")}
                </button>
              </div>
              {groups.map(({ category: c, rows: rs }) => {
                const done = c.items.filter((x) => x.visited).length;
                const open = !collapsed.includes(c.id);
                return (
                  <section key={c.id} className="space-y-3">
                    <h2>
                      <button
                        type="button"
                        onClick={() => fold(open ? [...collapsed, c.id] : collapsed.filter((id) => id !== c.id))}
                        aria-expanded={open}
                        className="flex w-full items-center gap-3 rounded-xl py-1 text-left hover:bg-black/[0.02]"
                      >
                        <span className={`text-xs text-[#8f8676] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
                          ▶
                        </span>
                        <span className="text-lg font-semibold text-[#1f1c17]">
                          {c.emoji} {c.title}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-[#8f8676]">
                          {done}/{c.items.length}
                        </span>
                        <span className="hidden h-1.5 max-w-40 flex-1 overflow-hidden rounded-full bg-[#efe9dc] sm:block" aria-hidden>
                          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${c.items.length ? (done / c.items.length) * 100 : 0}%` }} />
                        </span>
                      </button>
                    </h2>
                    {open ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rs.map(card)}</div> : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{shown.map(card)}</div>
          )}
        </>
      )}

      {editing ? (
        <Editor editing={editing} categories={data.categories} onSave={save} onDelete={() => remove(editing.place.id)} onClose={() => setEditing(null)} />
      ) : null}
      {countriesOpen ? (
        <CountriesEditor
          chosen={data.countries}
          fromPlaces={fromPlaces}
          onSave={(codes) => {
            edit((p) => ({ ...p, countries: codes }));
            setCountriesOpen(false);
          }}
          onClose={() => setCountriesOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Every country you've been to: searchable, with the ones your visited places are in offered first. */
function CountriesEditor({ chosen, fromPlaces, onSave, onClose }: { chosen: string[]; fromPlaces: string[]; onSave: (codes: string[]) => void; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  // A first list starts from the countries of the places you've been to.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(chosen.length ? chosen : fromPlaces));
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const all = useMemo(() => ALL_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)), [locale]);
  const q = norm(query.trim());
  const listed = all.filter((c) => !q || norm(c.name).includes(q) || c.code.toLowerCase() === q);
  const missing = fromPlaces.filter((c) => !picked.has(c));
  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("My countries")} className="flex max-h-[90vh] w-full max-w-md flex-col gap-3 rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-[#1f1c17]">{t("My countries")}</h2>
          <span className="text-sm tabular-nums text-[#8f8676]">
            {picked.size} / {WORLD_COUNTRIES}
          </span>
        </div>
        {missing.length ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {t("From the places you've visited: {list}.", { list: missing.map((c) => countryName(c, locale)).join(", ") })}{" "}
            <button type="button" onClick={() => setPicked((prev) => new Set([...prev, ...missing]))} className="font-semibold underline underline-offset-2">
              {t("Add them")}
            </button>
          </p>
        ) : null}
        <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Find a country…")} aria-label={t("Find a country…")} className={`${field} w-full`} />
        {picked.size ? (
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {[...picked]
              .map((code) => ({ code, name: countryName(code, locale) }))
              .sort((a, b) => a.name.localeCompare(b.name, locale))
              .map((c) => (
                <button key={c.code} type="button" onClick={() => toggle(c.code)} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-200" title={t("Remove")}>
                  {c.name} ✕
                </button>
              ))}
          </div>
        ) : null}
        <ul className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-black/5">
          {listed.map((c) => (
            <li key={c.code}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-[#3b352d] hover:bg-[#faf8f2]">
                <input type="checkbox" checked={picked.has(c.code)} onChange={() => toggle(c.code)} />
                {c.name}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button type="button" onClick={() => onSave([...picked].sort())} className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb]">
            {t("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <PlacesPage />
    </RequireAuth>
  );
}
