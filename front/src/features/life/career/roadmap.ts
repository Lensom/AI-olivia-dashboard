/**
 * The Node + AI roadmap: what to learn before moving to the Netherlands, by topic, in the order of the weekly plan from
 * 23.11. Progress is stored per item id (back/app/career/router.py), so ids must never change once used; new items
 * just show up as not started.
 */

export type Track = "py" | "ai" | "node" | "prep";

export type RoadmapItem = { id: string; name: string; hint: string; must: boolean };

export type RoadmapTopic = {
  track: Track;
  title: string;
  /** As planned, in words. */
  when: string;
  /** The planned weeks as ISO days, for "Now": none for something done alongside everything. */
  from?: string;
  to?: string;
  why: string;
  items: RoadmapItem[];
};

export const TRACKS: Record<Track, { label: string; dot: string; tag: string; must: string }> = {
  py: { label: "Python", dot: "border-amber-600 text-amber-700", tag: "bg-amber-50 text-amber-800", must: "border-amber-400/70" },
  ai: { label: "AI", dot: "border-blue-600 text-blue-700", tag: "bg-blue-50 text-blue-800", must: "border-blue-400/70" },
  node: { label: "Node.js", dot: "border-emerald-700 text-emerald-700", tag: "bg-emerald-50 text-emerald-800", must: "border-emerald-500/70" },
  prep: { label: "Співбесіди", dot: "border-stone-500 text-stone-600", tag: "bg-stone-100 text-stone-700", must: "border-stone-400" },
};

const item = (id: string, name: string, hint: string, must: 0 | 1): RoadmapItem => ({ id, name, hint, must: must === 1 });

export const ROADMAP: RoadmapTopic[] = [
  {
    track: "py",
    title: "Python",
    when: "паралельно, весь час",
    why: "Вже вчите. Мова для AI-експериментів у вашому проєкті; не основний бекенд для резюме.",
    items: [item("py", "Python", "Те, що вже вчите — один пункт, без деталізації", 1)],
  },
  {
    track: "ai",
    title: "Основи LLM",
    when: "тиждень 1 · 23–29.11, вже в процесі",
    from: "2026-11-23",
    to: "2026-11-29",
    why: "Фундамент: без цього AI-фічі виглядають як магія, а на співбесіді питають саме це.",
    items: [
      item("l-tok", "Токени і контекст", "Context window, ліміти, вартість", 1),
      item("l-param", "Параметри генерації", "Temperature, max tokens, stop sequences", 1),
      item("l-prompt", "Prompt engineering", "System prompt, приклади, XML-теги, ролі", 1),
      item("l-model", "Вибір моделі", "Якість vs ціна vs затримка", 1),
      item("l-struct", "Structured output", "JSON Schema, валідація відповіді", 1),
      item("l-limit", "Обмеження LLM", "Галюцинації, застарілі знання, недетермінованість", 1),
    ],
  },
  {
    track: "ai",
    title: "AI у продукті (TypeScript)",
    when: "тижні 1–3 · до 13.12",
    from: "2026-11-23",
    to: "2026-12-13",
    why: "Ваша головна відмінність: senior React, який вміє вбудувати LLM у продукт. На старті вистачить Next.js route handlers — окремий Node-бекенд не потрібен.",
    items: [
      item("p-sdk", "Claude API / Anthropic SDK", "Messages API, системні промпти, обробка помилок", 1),
      item("p-stream", "Streaming", "Стрімінг відповіді з сервера в UI", 1),
      item("p-vercel", "Vercel AI SDK", "streamText, useChat, generateObject", 1),
      item("p-tool", "Tool calling", "Модель викликає ваші функції", 1),
      item("p-agent", "Агентний цикл", "Loop: модель → інструмент → результат → модель", 1),
      item("p-mcp", "MCP", "Свій MCP-сервер, підключення до клієнта", 1),
      item("p-cache", "Prompt caching", "Як знизити вартість і затримку", 0),
      item("p-ux", "UX для AI", "Стани завантаження, переривання, повтор, фідбек", 1),
    ],
  },
  {
    track: "ai",
    title: "Курси Claude Academy",
    when: "тижні 1–4 · до 20.12",
    from: "2026-11-23",
    to: "2026-12-20",
    why: "Безкоштовні, з бейджем для LinkedIn. Кожен курс одразу застосовуйте у проєкті.",
    items: [
      item("c-api", "Building with the Claude API", "", 1),
      item("c-tool", "Tool Use with the Messages API", "", 1),
      item("c-mcp1", "Introduction to Model Context Protocol", "", 1),
      item("c-mcp2", "MCP: Advanced Topics", "", 0),
      item("c-code", "Claude Code in Action", "", 0),
      item("c-li", "Бейджі в LinkedIn", "Licenses & Certifications", 1),
    ],
  },
  {
    track: "ai",
    title: "RAG: пошук по своїх даних",
    when: "тижні 3–4 · 07–20.12",
    from: "2026-12-07",
    to: "2026-12-20",
    why: "Найпоширеніший сценарій AI у компаніях: відповіді по документах.",
    items: [
      item("r-emb", "Embeddings", "Що це і як рахувати схожість", 1),
      item("r-chunk", "Chunking", "Як різати документи на шматки", 1),
      item("r-pgv", "pgvector", "Векторний пошук у PostgreSQL", 1),
      item("r-ret", "Retrieval і reranking", "Top-k, гібридний пошук, переранжування", 0),
      item("r-cite", "Цитування джерел", "Відповідь із посиланнями на документи", 0),
    ],
  },
  {
    track: "ai",
    title: "Якість, вартість і безпека AI",
    when: "тиждень 4 + свята · 14.12–03.01",
    from: "2026-12-14",
    to: "2027-01-03",
    why: "Те, що відрізняє демо від продакшн-фічі. Сильні аргументи на співбесіді.",
    items: [
      item("q-eval", "Evals", "Набір тестових запитів, оцінка відповідей", 1),
      item("q-cost", "Вартість і затримка", "Лог токенів, бюджет на запит", 1),
      item("q-fall", "Fallback і ретраї", "Таймаути, rate limits, запасна модель", 0),
      item("q-trace", "Трейсинг", "Langfuse або аналог: що модель бачила і відповіла", 0),
      item("q-inj", "Prompt injection", "Що це і як зменшити ризик", 1),
      item("q-num", "Цифри для CV", "Виміряти свою AI-фічу: час, вартість, точність", 1),
    ],
  },
  {
    track: "node",
    title: "Node.js: основи рантайму",
    when: "свята · 21.12–03.01",
    from: "2026-12-21",
    to: "2027-01-03",
    why: "Те, про що питають першим: як Node виконує код і чим відрізняється від браузера.",
    items: [
      item("n-loop", "Event loop", "Фази, microtasks vs macrotasks, чому не блокувати потік", 1),
      item("n-async", "Async-патерни", "Promises, async/await, Promise.all/allSettled, обробка помилок", 1),
      item("n-mod", "Модулі", "ESM vs CommonJS, package.json, exports, tsconfig для Node", 1),
      item("n-core", "Core API", "fs, path, process, env, EventEmitter", 1),
      item("n-stream", "Streams і Buffer", "Читання великих файлів, pipeline, backpressure", 0),
      item("n-npm", "Пакети і скрипти", "npm/pnpm, lock-файли, semver, npx", 0),
      item("n-worker", "Worker threads", "Коли CPU-задачі виносити з основного потоку", 0),
    ],
  },
  {
    track: "node",
    title: "HTTP і API",
    when: "тиждень 7 · 04–10.01",
    from: "2027-01-04",
    to: "2027-01-10",
    why: "Окремий REST API, який Next.js викликає як BFF. Сюди переїжджають ваші AI-фічі.",
    items: [
      item("h-rest", "REST-дизайн", "Ресурси, статус-коди, пагінація, ідемпотентність", 1),
      item("h-fw", "Fastify або Express", "Роутинг, middleware/hooks, плагіни", 1),
      item("h-zod", "Валідація з Zod", "Схеми для body/query, типи з однієї схеми", 1),
      item("h-err", "Помилки і логи", "Централізований error handler, pino", 1),
      item("h-nest", "NestJS: основи", "Modules, controllers, providers, DI — часто у вакансіях", 0),
      item("h-openapi", "OpenAPI / Swagger", "Документація API, генерація клієнта", 0),
      item("h-sse", "SSE і WebSockets", "Стрімінг з сервера — знадобиться для AI-відповідей", 1),
      item("h-sec", "CORS і rate limiting", "Базовий захист публічного API", 0),
    ],
  },
  {
    track: "node",
    title: "Бази даних",
    when: "тиждень 8 · 11–17.01",
    from: "2027-01-11",
    to: "2027-01-17",
    why: "Без SQL бекенд-співбесіду не пройти. PostgreSQL — стандарт у NL-компаніях.",
    items: [
      item("d-sql", "SQL", "JOIN, GROUP BY, підзапити", 1),
      item("d-pg", "PostgreSQL", "Типи, constraints, JSONB", 1),
      item("d-idx", "Індекси і план запиту", "EXPLAIN, коли індекс допомагає", 1),
      item("d-tx", "Транзакції", "ACID, рівні ізоляції на базовому рівні", 1),
      item("d-orm", "Prisma або Drizzle", "Схема, запити, зв'язки", 1),
      item("d-mig", "Міграції", "Як безпечно змінювати схему на проді", 1),
      item("d-n1", "N+1 і продуктивність", "Як знайти й виправити", 0),
      item("d-redis", "Redis", "Кеш, сесії, черги", 0),
    ],
  },
  {
    track: "node",
    title: "Auth і безпека",
    when: "тиждень 8 · 11–17.01",
    from: "2027-01-11",
    to: "2027-01-17",
    why: "Питають на кожній fullstack-співбесіді.",
    items: [
      item("a-sess", "Sessions vs JWT", "Плюси, мінуси, де зберігати токени", 1),
      item("a-hash", "Хешування паролів", "argon2/bcrypt, чому не SHA", 1),
      item("a-oauth", "OAuth2 / OIDC", "Authorization code flow, вхід через Google", 0),
      item("a-owasp", "OWASP API Top 10", "Injection, broken auth, IDOR", 1),
      item("a-secret", "Секрети і env", "Ніяких ключів у репозиторії", 0),
    ],
  },
  {
    track: "node",
    title: "Тестування бекенду",
    when: "тиждень 9 · 18–24.01",
    from: "2027-01-18",
    to: "2027-01-24",
    why: "Ви вже знаєте Jest і Playwright — переносимо на API.",
    items: [
      item("t-unit", "Unit-тести", "Vitest або Jest для сервісів", 1),
      item("t-int", "Інтеграційні тести", "Тестова БД, фікстури", 1),
      item("t-api", "API-тести", "supertest або inject у Fastify", 0),
      item("t-mock", "Моки", "Зовнішні API, LLM-виклики", 0),
    ],
  },
  {
    track: "node",
    title: "Docker, CI і хмара",
    when: "тижні 9–10 · 18–31.01",
    from: "2027-01-18",
    to: "2027-01-31",
    why: "Senior має розуміти, як код потрапляє в прод. Достатньо базового рівня.",
    items: [
      item("o-docker", "Dockerfile", "Multi-stage build для Node", 1),
      item("o-compose", "docker-compose", "API + Postgres локально", 1),
      item("o-ci", "CI на GitHub Actions", "Лінт, тести, білд на кожен PR", 1),
      item("o-aws", "Деплой на AWS", "App Runner або ECS, RDS, S3 — базово", 0),
      item("o-obs", "Моніторинг", "Sentry, структуровані логи, метрики", 0),
      item("o-bff", "BFF з Next.js", "Next.js як фронт до вашого API", 1),
    ],
  },
  {
    track: "prep",
    title: "Готовність до співбесід",
    when: "тижні 4–10",
    from: "2026-12-14",
    to: "2027-01-31",
    why: "Пункти-фінішні: коли вони готові, технологію можна чесно додати в CV.",
    items: [
      item("i-fsd", "Frontend system design", "News feed, autocomplete, design system для багатьох команд", 1),
      item("i-bsd", "Backend system design: основи", "Кеш, черги, масштабування, rate limiting", 1),
      item("i-node15", "Node: 15 хвилин без пауз", "Можу пояснити свій API і відповісти на питання → додати в CV (кінець січня)", 1),
      item("i-ai3", "AI-кейс на 2–3 хвилини", "Що зробив, яка модель, проблеми, цифри", 1),
      item("i-repo", "Проєкт на GitHub", "Чистий README, закріплений у профілі", 0),
    ],
  },
];

export type Progress = Record<string, 1 | 2>;

/**
 * The backup code of the HTML roadmap ("Скопіювати код прогресу"): base64 of its progress JSON. Only known item ids
 * with 1 or 2 are taken; anything else in it is ignored.
 */
export function parseBackupCode(code: string): Progress | null {
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0)));
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const known = new Set(ROADMAP.flatMap((t) => t.items.map((i) => i.id)));
    const out: Progress = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (known.has(id) && (v === 1 || v === 2)) out[id] = v;
    return out;
  } catch {
    return null;
  }
}
