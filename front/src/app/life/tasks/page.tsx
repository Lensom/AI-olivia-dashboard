"use client";

import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { investingPrimarySaveActive, investingToolbarBtnSm } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

/** Mirrors back/app/tasks/router.py. */
type TaskStatus = "todo" | "hold" | "in_progress" | "completed";
type Task = { id: string; title: string; status: TaskStatus; created_at: string; completed_at: string };

const COLUMNS: { status: TaskStatus; label: string; dot: string; tint: string }[] = [
  { status: "todo", label: "To do", dot: "bg-stone-400", tint: "bg-[#f6f3ec]" },
  { status: "hold", label: "Hold", dot: "bg-amber-500", tint: "bg-[#fbf4e4]" },
  { status: "in_progress", label: "In progress", dot: "bg-sky-500", tint: "bg-[#eef5fb]" },
  { status: "completed", label: "Completed", dot: "bg-emerald-500", tint: "bg-[#edf7f1]" },
];

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}`);

/** Moves a task to `status`, placed before `beforeId` (or at the end of that column). */
function moveTask(tasks: Task[], id: string, status: TaskStatus, beforeId: string | null): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task || id === beforeId) return tasks;
  const moved: Task = {
    ...task,
    status,
    completed_at: status === "completed" ? task.completed_at || new Date().toISOString() : "",
  };
  const rest = tasks.filter((t) => t.id !== id);
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)];
  // End of the column: after its last task, so the order of other columns is untouched.
  const lastInColumn = rest.map((t) => t.status).lastIndexOf(status);
  return [...rest.slice(0, lastInColumn + 1), moved, ...rest.slice(lastInColumn + 1)];
}

function TaskCard({
  task,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropOnCard,
  onRename,
  onDelete,
  onStep,
}: {
  task: Task;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverCard: () => void;
  onDropOnCard: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const col = COLUMNS.findIndex((c) => c.status === task.status);

  const finish = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== task.title) onRename(t);
    else setDraft(task.title);
  };

  return (
    <li
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOverCard();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropOnCard();
      }}
      className="group relative"
    >
      {dropBefore ? <span aria-hidden className="absolute -top-1.5 left-1 right-1 h-0.5 rounded bg-[#2a78d6]" /> : null}
      <div
        className={`flex items-start gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(18,16,13,0.06)] transition ${
          dragging ? "opacity-40" : "hover:shadow-[0_4px_12px_rgba(18,16,13,0.08)]"
        } ${editing ? "" : "cursor-grab active:cursor-grabbing"}`}
      >
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish();
              if (e.key === "Escape") {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            autoFocus
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-black/10 px-1.5 py-0.5 text-sm outline-none focus:border-black/25"
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            title={t("Double-click to rename")}
            className={`min-w-0 flex-1 break-words text-sm ${task.status === "completed" ? "text-[#8f8676] line-through decoration-black/20" : "text-[#1f1c17]"}`}
          >
            {task.title}
          </span>
        )}
        {!editing ? (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <button type="button" onClick={() => onStep(-1)} disabled={col === 0} aria-label={t("Move “{title}” left", { title: task.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17] disabled:invisible">
              ‹
            </button>
            <button type="button" onClick={() => onStep(1)} disabled={col === COLUMNS.length - 1} aria-label={t("Move “{title}” right", { title: task.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17] disabled:invisible">
              ›
            </button>
            <button type="button" onClick={() => setEditing(true)} aria-label={t("Rename “{title}”", { title: task.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]">
              ✎
            </button>
            <button type="button" onClick={onDelete} aria-label={t("Delete “{title}”", { title: task.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-rose-50 hover:text-rose-700">
              ✕
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default function TasksPage() {
  const { token } = useAuth();
  const t = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; beforeId: string | null } | null>(null);
  const latest = useRef<Task[]>([]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ tasks: Task[] }>("/tasks", { token })
      .then((d) => {
        latest.current = d.tasks;
        setTasks(d.tasks);
      })
      .catch(() => setError("Could not load your tasks. Is the backend running?"))
      .finally(() => setLoaded(true));
  }, [token]);

  /** Applies a change right away and saves it; puts the board back if saving fails. */
  async function commit(change: (t: Task[]) => Task[]) {
    const prev = latest.current;
    const next = change(prev);
    if (next === prev) return;
    latest.current = next;
    setTasks(next);
    try {
      await apiFetch("/tasks", { token: token ?? undefined, method: "PUT", body: JSON.stringify({ tasks: next }) });
      setError(null);
    } catch {
      if (latest.current === next) {
        latest.current = prev;
        setTasks(prev);
      }
      setError("Could not save — the change was undone.");
    }
  }

  function addTask() {
    const name = title.trim();
    if (!name) return;
    setTitle("");
    void commit((all) => [{ id: newId(), title: name, status: "todo", created_at: new Date().toISOString(), completed_at: "" }, ...all]);
  }

  function drop(status: TaskStatus, beforeId: string | null) {
    if (dragId) void commit((all) => moveTask(all, dragId, status, beforeId));
    setDragId(null);
    setOver(null);
  }

  const doneCount = tasks.filter((x) => x.status === "completed").length;

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Task manager")}</h1>
          </div>
          {doneCount ? (
            <button type="button" onClick={() => void commit((all) => all.filter((x) => x.status !== "completed"))} className={investingToolbarBtnSm}>
              {t("Clear {n} completed", { n: doneCount })}
            </button>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addTask();
          }}
          className="flex gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("New task — press Enter to add it to To do")}
            maxLength={500}
            className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none focus:border-black/25"
          />
          <button type="submit" disabled={!title.trim()} className={`${investingPrimarySaveActive} disabled:opacity-40`}>
            {t("Add task")}
          </button>
        </form>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(error)}</p> : null}

        {!loaded ? (
          <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            {COLUMNS.map((c) => {
              const list = tasks.filter((x) => x.status === c.status);
              const isOver = over?.status === c.status && dragId != null;
              return (
                <section
                  key={c.status}
                  aria-label={t(c.label)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (over?.status !== c.status || over.beforeId !== null) setOver({ status: c.status, beforeId: null });
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(c.status, null);
                  }}
                  className={`flex min-h-[260px] flex-col rounded-2xl p-3 transition ${c.tint} ${isOver ? "ring-2 ring-[#2a78d6]/40" : ""}`}
                >
                  <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-[#1f1c17]">
                    <span aria-hidden className={`h-2 w-2 rounded-full ${c.dot}`} />
                    {t(c.label)}
                    <span className="ml-auto rounded-full bg-white/80 px-2 text-xs font-medium tabular-nums text-[#6f675b]">{list.length}</span>
                  </h2>
                  <ul className="flex flex-1 flex-col gap-2">
                    {list.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        dragging={dragId === task.id}
                        dropBefore={isOver && over?.beforeId === task.id && dragId !== task.id}
                        onDragStart={() => setDragId(task.id)}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onDragOverCard={() => {
                          if (over?.beforeId !== task.id) setOver({ status: c.status, beforeId: task.id });
                        }}
                        onDropOnCard={() => drop(c.status, task.id)}
                        onRename={(name) => void commit((all) => all.map((x) => (x.id === task.id ? { ...x, title: name } : x)))}
                        onDelete={() => void commit((all) => all.filter((x) => x.id !== task.id))}
                        onStep={(dir) => {
                          const target = COLUMNS[COLUMNS.findIndex((x) => x.status === task.status) + dir];
                          if (target) void commit((all) => moveTask(all, task.id, target.status, null));
                        }}
                      />
                    ))}
                    {!list.length ? (
                      <li className={`flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-6 text-center text-xs ${isOver ? "border-[#2a78d6]/50 text-[#2a78d6]" : "border-black/10 text-[#a39a89]"}`}>
                        {dragId ? t("Drop here") : c.status === "todo" ? t("Add a task above") : t("Drag tasks here")}
                      </li>
                    ) : null}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
