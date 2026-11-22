/**
 * The weekly plan for a job in the Netherlands (start 23.11.2026). Ticks are stored by item id
 * (back/app/career/router.py), so ids must never change once used.
 *
 * Learning follows the roadmap (roadmap.ts): AI first, Node.js from the holidays. The plan's original PDF had Node.js
 * in weeks 1–4; its learning items were moved to match.
 */

export type PlanItem = { id: string; text: string };
export type PlanGroup = { title: string; items: PlanItem[] };

export type Checkpoint = {
  date: string;
  /** Applications sent by then, as planned. */
  applications: [number, number];
  /** Recruiter calls by then, as planned (when the plan says). */
  calls?: [number, number];
  text: string;
};

export type PlanWeek = {
  id: string;
  label: string;
  phase: 1 | 2 | 3;
  from: string;
  to: string;
  goal: string;
  /** Applications to send each calendar week of it. */
  applications: [number, number];
  /** The holidays: lighter rhythm, no messages or mock interviews asked. */
  light?: boolean;
  groups: PlanGroup[];
  checkpoint?: Checkpoint;
};

export const PLAN_TITLE = "План по тижнях: робота в Нідерландах";
export const PLAN_GOAL = "Офер Senior Frontend / Product Engineer від компанії-спонсора з базою від €6,500 брутто на місяць · Переїзд: березень–квітень 2027";

export const PHASES: Record<number, { title: string }> = {
  1: { title: "Фаза 1. Запуск і пік до свят" },
  2: { title: "Фаза 2. Свята: легкий режим" },
  3: { title: "Фаза 3. Основний бій" },
};

/** The rhythm every week except the holidays. `key` ties a row to what the page counts. */
export const WEEKLY_BASE: { key: "applications" | "messages" | "learning" | "mock" | "post" | "funnel"; what: string; target: string; how: string }[] = [
  { key: "applications", what: "Цільові подачі", target: "8–10", how: "Тільки компанії з реєстру IND. 5–7 ключових слів вакансії в CV. Лист до 150 слів." },
  { key: "messages", what: "Повідомлення людям", target: "5", how: "Реферали від знайомих, 15-хвилинні розмови з незнайомими, follow-up після подачі." },
  { key: "learning", what: "Навчання", target: "5–7 год", how: "За планом тижня. Щодня по 45 хвилин краще, ніж 5 годин у неділю." },
  { key: "mock", what: "Mock-інтерв'ю англійською", target: "1", how: "Зі мною, з другом або на Pramp. Чергуємо: behavioral, live coding, system design." },
  { key: "post", what: "Пост у LinkedIn", target: "1", how: "Коротко: чого навчились, кейс із design system або AI." },
  { key: "funnel", what: "П'ятниця: воронка", target: "15 хв", how: "Оновити таблицю подач, порахувати конверсії, надіслати мені цифри." },
];

const g = (title: string, items: [string, string][]): PlanGroup => ({ title, items: items.map(([id, text]) => ({ id, text })) });

export const PLAN: PlanWeek[] = [
  {
    id: "w1", label: "Тиждень 1", phase: 1, from: "2026-11-23", to: "2026-11-29", applications: [5, 5],
    goal: "Все готово до масових подач + перші 5 подач",
    groups: [
      g("Пошук", [
        ["w1-linkedin", "LinkedIn: headline, About як summary з CV, дата Autodoc Aug 2026, Open to Work лише для рекрутерів"],
        ["w1-readme", "Новий README на GitHub, закріпити 2–3 репозиторії"],
        ["w1-table", "Таблиця подач: компанія, дата, канал, етап, зарплата, спонсорство"],
        ["w1-companies", "Список 40 компаній у хвилях A/B/C, кожну перевірити в реєстрі IND і на Levels.fyi"],
        ["w1-people", "Знайти 20 людей для рефералів у компаніях хвилі B"],
        ["w1-wave-a", "5 подач хвилі A (розігрів)"],
      ]),
      g("Навчання і підготовка", [
        ["w1-pitch", "Записати pitch на 60 секунд, вимовити вголос 5 разів"],
        ["w1-llm", "AI: основи LLM — токени і контекст, параметри, prompt engineering, structured output"],
        ["w1-sdk", "AI у продукті: Claude API / Anthropic SDK у своєму проєкті (Next.js route handler)"],
      ]),
      g("Документи", [
        ["w1-passports", "Термін дії паспортів у вас обох (віза HSM видається не довше, ніж діє паспорт)"],
        ["w1-reserve", "Лише якщо паспорт спливає раніше ніж за 2–3 роки: оновити дані в Резерв+ і замінити паспорт до оферу"],
        ["w1-partner", "Почати збирати докази спільного проживання з партнером"],
      ]),
    ],
  },
  {
    id: "w2", label: "Тиждень 2", phase: 1, from: "2026-11-30", to: "2026-12-06", applications: [10, 10],
    goal: "Повний ритм — 10 подач, 5 повідомлень",
    groups: [
      g("Пошук", [
        ["w2-wave-a", "Решта хвилі A + перші 5 компаній хвилі B"],
        ["w2-referrals", "Перші реферальні запити (знайомим — одразу)"],
        ["w2-calls", "Перші дзвінки рекрутерів: зарплата і спонсорство на першому дзвінку"],
      ]),
      g("Навчання і підготовка", [
        ["w2-star", "STAR-історії 1–3: returns-платформа, Constanta UI, конфлікт"],
        ["w2-mock", "Mock #1: behavioral"],
        ["w2-stream", "AI у продукті: streaming у UI, Vercel AI SDK (streamText, useChat)"],
      ]),
    ],
  },
  {
    id: "w3", label: "Тиждень 3", phase: 1, from: "2026-12-07", to: "2026-12-13", applications: [10, 12],
    goal: "Найсильніший тиждень — все, що подано до ~15.12, встигає до свят",
    groups: [
      g("Пошук", [
        ["w3-wave-b", "10–12 подач хвилі B"],
        ["w3-referrals", "Усі реферальні запити по хвилі B надіслати до 13.12"],
        ["w3-followup", "Follow-up усім рекрутерам без відповіді"],
      ]),
      g("Навчання і підготовка", [
        ["w3-star", "STAR-історії 4–5: менторинг, провал"],
        ["w3-mock", "Mock #2: live coding"],
        ["w3-tools", "AI у продукті: tool calling і агентний цикл; RAG: embeddings, chunking"],
        ["w3-course", "Курс Claude Academy: Building with the Claude API"],
      ]),
    ],
  },
  {
    id: "w4", label: "Тиждень 4", phase: 1, from: "2026-12-14", to: "2026-12-20", applications: [8, 8],
    goal: "Провести перші співбесіди і закрити рік з процесами в роботі",
    groups: [
      g("Пошук", [
        ["w4-apply", "8 подач (B + перші з C, якщо почуваєтесь у формі)"],
        ["w4-next", "Попросити рекрутерів назвати наступні етапи на січень"],
      ]),
      g("Навчання і підготовка", [
        ["w4-mock", "Mock #3: frontend system design (news feed)"],
        ["w4-rag", "RAG: pgvector; якість AI: evals, вартість і затримка, prompt injection"],
      ]),
    ],
    checkpoint: {
      date: "2026-12-20",
      applications: [30, 35],
      calls: [3, 5],
      text: "Контрольна точка 1 (20.12): ~30–35 подач, 3–5 дзвінків рекрутерів. Якщо дзвінків 0–1 — переглядаємо CV і список компаній.",
    },
  },
  {
    id: "w5", label: "Тижні 5–6", phase: 2, from: "2026-12-21", to: "2027-01-03", applications: [3, 4], light: true,
    goal: "Не випасти з ритму, але відпочити. Найм у NL у ці тижні майже стоїть",
    groups: [
      g("Пошук", [
        ["w5-apply", "3–4 подачі на тиждень, щоб бути в черзі на початок січня"],
        ["w5-reply", "Відповідати рекрутерам, не більше"],
      ]),
      g("Навчання", [
        ["w5-courses", "Курси Claude Academy: Tool Use, Intro to MCP"],
        ["w5-ai", "Перша AI-фіча у своєму проєкті (tool calling)"],
        ["w5-node", "Node.js: основи рантайму — event loop, async-патерни, модулі, core API"],
      ]),
    ],
  },
  {
    id: "w7", label: "Тиждень 7", phase: 3, from: "2027-01-04", to: "2027-01-10", applications: [10, 10],
    goal: "Перезапуск — усі процеси знову в русі",
    groups: [
      g("Пошук", [
        ["w7-followup", "Follow-up усім процесам і рекрутерам 05.01"],
        ["w7-apply", "10 подач: залишок B + хвиля C (Adyen, Booking, Uber, Stripe)"],
      ]),
      g("Навчання і підготовка", [
        ["w7-mock", "Mock #4: behavioral, «why Netherlands», «what are you doing now»"],
        ["w7-ai", "AI-фіча: виміряти час відповіді, вартість, обробку помилок"],
        ["w7-http", "Node.js: HTTP і API — Fastify або Express, валідація з Zod, SSE (старт API у своєму проєкті)"],
      ]),
    ],
  },
  {
    id: "w8", label: "Тиждень 8", phase: 3, from: "2027-01-11", to: "2027-01-17", applications: [8, 10],
    goal: "Технічні етапи без провалів",
    groups: [
      g("Пошук", [
        ["w8-apply", "8–10 подач, нові вакансії після свят"],
        ["w8-notes", "Після кожної співбесіди — 10 хвилин нотаток і розбір зі мною"],
      ]),
      g("Навчання і підготовка", [
        ["w8-mock", "Mock #5: system design (autocomplete або design system для багатьох команд)"],
        ["w8-course", "Курс: MCP Advanced Topics"],
        ["w8-db", "Node.js: PostgreSQL, Prisma або Drizzle, міграції, auth (sessions vs JWT)"],
      ]),
    ],
  },
  {
    id: "w9", label: "Тиждень 9", phase: 3, from: "2027-01-18", to: "2027-01-24", applications: [8, 8],
    goal: "Вийти на фінальні етапи",
    groups: [
      g("Пошук", [
        ["w9-apply", "8 подач, нові реферальні запити"],
        ["w9-wider", "Розширити список: Ейндговен, Роттердам, remote → relocation"],
      ]),
      g("Навчання і підготовка", [
        ["w9-questions", "Підготувати питання до компаній для фіналів"],
        ["w9-tests", "Node.js: тести API, Dockerfile + docker-compose"],
        ["w9-deploy", "Деплой проєкту: CI + AWS, Sentry"],
      ]),
    ],
    checkpoint: {
      date: "2027-01-24",
      applications: [65, 70],
      text: "Контрольна точка 2 (24.01): ~65–70 подач. Якщо відгук нижче 1 з 10 — міняємо CV і канали. Якщо дзвінки є, а технічних етапів немає — переписуємо pitch.",
    },
  },
  {
    id: "w10", label: "Тиждень 10", phase: 3, from: "2027-01-25", to: "2027-01-31", applications: [8, 8],
    goal: "2–3 процеси у фіналі одночасно",
    groups: [
      g("Пошук", [
        ["w10-apply", "8 подач — не зупинятися, поки немає підписаного оферу"],
        ["w10-sync", "Синхронізувати процеси: якщо одна компанія швидша, попросити інших прискоритись"],
      ]),
      g("Навчання і підготовка", [
        ["w10-course", "Курс: Claude Code in Action, бейджі в LinkedIn"],
        ["w10-checklist", "Розібрати чекліст оферу"],
        ["w10-cv", "Node.js: 15 хвилин без пауз про свій API — тоді додати в CV і LinkedIn"],
      ]),
    ],
  },
  {
    id: "w11", label: "Тижні 11–12", phase: 3, from: "2027-02-01", to: "2027-02-14", applications: [8, 8],
    goal: "Офер і переговори (медіанна дата оферу — ~08.02)",
    groups: [
      g("Офер", [
        ["w11-wait", "Не приймати одразу: «Can I have a few days to review it with my partner?»"],
        ["w11-others", "Згадати інші процеси, якщо є"],
        ["w11-tell", "Сказати іншим компаніям, що маєте офер, і попросити рішення"],
      ]),
      g("Чекліст оферу (письмово)", [
        ["offer-base", "Фіксована база вище порогу HSM 2027"],
        ["offer-hsm", "HSM для вас і партнера, оплата візи"],
        ["offer-ruling", "Заявка на 30%/27% ruling"],
        ["offer-relocation", "Relocation package + тимчасове житло на 1–2 місяці"],
      ]),
    ],
  },
];

/** From an offer to moving, as planned (~6–8 weeks). */
export const AFTER_OFFER: [string, string][] = [
  ["Тиждень після підпису", "Повідомити Eeze. Notice period у Румунії зазвичай 20 робочих днів — перевірте контракт."],
  ["Тижні 1–3", "Роботодавець подає HSM у IND для вас і партнера. Для визнаного спонсора рішення зазвичай ~2 тижні (юридичний максимум — 90 днів)."],
  ["Тижні 2–5", "Візит до посольства NL за візою MVV (якщо потрібна). Апостилі та переклади документів. Пошук житла."],
  ["Березень – квітень 2027", "Переїзд, реєстрація в муніципалітеті (BSN), банк, медичне страхування."],
];

export const NO_OFFER_BY_FEB: string[] = [
  "Це нормально: базовий шанс на цю дату ~50%. Не змінюємо стратегію, змінюємо слабкий етап воронки.",
  "Розбираємо всі відмови і фідбек, підтягуємо слабкий тип співбесіди.",
  "Розширюємо коло: frontend-leaning fullstack, product engineer, Ейндговен і Роттердам, remote у NL-компанії з переїздом пізніше.",
  "Продовжуємо ритм до 92% шансу (~травень 2027).",
];

/** The plan's week for a day; before the start, the first; after the end, the last. */
export function weekFor(day: string): { week: PlanWeek; state: "before" | "during" | "after" } {
  if (day < PLAN[0].from) return { week: PLAN[0], state: "before" };
  const during = PLAN.find((w) => w.from <= day && day <= w.to);
  if (during) return { week: during, state: "during" };
  const next = PLAN.find((w) => w.from > day);
  return next ? { week: next, state: "before" } : { week: PLAN[PLAN.length - 1], state: "after" };
}

/** The Monday of a day's calendar week (ISO days, UTC). */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
