/** "Гайд: жорсткий режим пошуку роботи в Нідерландах" (13.11.2026): what to say, what to ask, what to keep in writing. */

export type Script = { id: string; title: string; text: string };

export const FORMULA: string[] = [
  "Ціль — компанії, які вже регулярно везуть іноземців (є в реєстрі IND, мають релокаційний пакет), а не всі вакансії підряд.",
  "Вхід через людей: реферал або рекрутер, який сам написав через LinkedIn.",
  "Зарплата і спонсорство — у перші 15 хвилин першого дзвінка.",
  "Типовий процес: HR → take-home або live coding → технічний розбір → system design або pair programming → behavioral. Зазвичай 4–6 тижнів.",
  "Після оферу роботодавець подає HSM для вас і партнера, плюс 30% ruling. Від оферу до переїзду зазвичай 1–3 місяці.",
];

export const CALL_SCRIPTS: Script[] = [
  {
    id: "pitch",
    title: "Pitch на 60 секунд",
    text: "I'm a senior frontend engineer with eight years in React and Next.js. Most recently at Autodoc I built a returns platform that handles over 40,000 requests a week. It made refunds twice as fast and cut support tickets by 90%. I also maintained the company design system used by 10 to 15 teams, and mentored and interviewed engineers. Lately I've been building AI features with LLM APIs and Node. I lived in the Netherlands before and I'm looking to move back with my partner.",
  },
  {
    id: "first-questions",
    title: "Два питання на першому ж дзвінку",
    text: "Before we go further, two practical things: does the company sponsor the highly skilled migrant permit, and what's the salary range for this role?",
  },
  {
    id: "expectations",
    title: "Якщо питають очікування",
    text: "I'm looking at 80 to 90 thousand euros base, plus holiday allowance. For the permit the base has to stay above the IND threshold, which goes up every January.",
  },
  {
    id: "too-low",
    title: "Якщо бюджет нижче планки",
    text: "Thanks for being upfront. That's below what I need for the permit, so I don't want to waste the team's time. If the range changes or a more senior role opens, I'd love to hear from you.",
  },
  {
    id: "doing-now",
    title: "Якщо питають, чим ви зараз займаєтесь",
    text: "I joined a company in Bucharest a few months ago, but my goal has been the Netherlands, so I'm looking for the right long-term team there.",
  },
  {
    id: "why-nl",
    title: "«Чому Нідерланди?»",
    text: "I lived there for a year and it's where my partner and I want to build our life long term. I'm looking for a company I can grow with, not a quick stepping stone.",
  },
  {
    id: "offer-wait",
    title: "Коли приходить офер",
    text: "Thank you, I'm excited. Can I have a few days to review it with my partner?",
  },
];

export const REFERRAL_SCRIPTS: Script[] = [
  {
    id: "ref-known",
    title: "Знайомій людині",
    text: "Hi Anna! I'm looking at the Senior Frontend Engineer role on your team at Mollie. I spent the last three years at Autodoc building a returns platform for 40K+ weekly requests and maintaining a design system used by 10-15 teams. Would you be open to referring me, or telling me a bit about the team first?",
  },
  {
    id: "ref-stranger",
    title: "Незнайомій людині",
    text: "Hi Tom, I saw you work on the frontend platform at Picnic. I'm a senior frontend engineer (React, Next.js, design systems) planning to move to the Netherlands and Picnic is high on my list. Could I ask you two or three questions about how the frontend team works? 15 minutes at your convenience.",
  },
  {
    id: "after-apply",
    title: "Після подачі — рекрутеру або hiring manager",
    text: "Just applied for X, here's the one thing I'd bring:",
  },
];

export const REFERRAL_TIPS: string[] = [
  "У LinkedIn шукайте в кожній цільовій компанії: колишніх колег з Autodoc і Moohii, українців, фронтендерів та engineering managers.",
  "Не просіть реферал у першому повідомленні незнайомим людям. Просіть 15 хвилин про команду, а про реферал питайте наприкінці розмови. Знайомим можна просити одразу.",
  "Реферер часто отримує бонус, тож ви не просите про послугу в один бік.",
];

export const APPLYING: string[] = [
  "Пріоритет каналів: реферал > рекрутер, який написав сам > пряма подача з повідомленням інженеру > холодна подача.",
  "Під кожну вакансію випишіть 5–7 ключових слів і переконайтеся, що вони є в CV (тільки те, що правда).",
  "Супровідний лист до 150 слів: три вимоги вакансії → три ваші докази з цифрами + одне речення про спонсорство.",
  "Рекрутери агенцій: 2–3 надійних, що спеціалізуються на релокації в NL. Перше питання — назва компанії, бюджет, спонсорство. Не дозволяйте двом рекрутерам подавати вас в одну компанію і не дозволяйте подавати без вашої згоди.",
  "LinkedIn headline: «Senior Frontend Engineer | React, Next.js, TypeScript | Design Systems | AI integrations | Relocating to the Netherlands». Open to Work лише для рекрутерів: Amsterdam, Rotterdam, Utrecht, Eindhoven, The Hague.",
];

export const STAR: { id: string; title: string; hint: string }[] = [
  { id: "star-1", title: "Вплив", hint: "Returns-платформа (2x швидші рефанди, −90% тікетів)." },
  { id: "star-2", title: "Лідерство без посади", hint: "Як ви перевели 10–15 команд з Bootstrap і Material UI на Constanta UI." },
  { id: "star-3", title: "Конфлікт", hint: "Розбіжність з дизайном або продуктом і як ви її вирішили." },
  { id: "star-4", title: "Менторинг", hint: "Конкретний джуніор або мідл і чим це закінчилося." },
  { id: "star-5", title: "Провал", hint: "Що пішло не так і що ви змінили після цього." },
];

export const TECHNICAL: [string, string][] = [
  ["Live coding", "Говоріть вголос увесь час. Спочатку уточніть вимоги, потім простий робочий варіант, потім покращення. Інтерв'юер оцінює хід думок, а не лише результат."],
  ["Take-home", "Додайте README з рішеннями і компромісами, тести, a11y. Не витрачайте більше часу, ніж просять, але напишіть, що б зробили далі."],
  ["Frontend system design", "Вимоги → архітектура компонентів → дані та API → стан і кеш → перформанс → a11y → тести та моніторинг. Тренуйте: news feed, autocomplete, дашборд із real-time, design system для багатьох команд."],
];

/** The same ids as week 11–12 of the plan: ticking one ticks it there too. */
export const OFFER_CHECKLIST: { id: string; text: string }[] = [
  { id: "offer-base", text: "Фіксована база вище порогу HSM 2027" },
  { id: "offer-hsm", text: "HSM для вас і партнера, оплата візи" },
  { id: "offer-ruling", text: "Заявка на 30%/27% ruling" },
  { id: "offer-relocation", text: "Relocation package + тимчасове житло на 1–2 місяці" },
];

export const OFFER_TIPS: string[] = [
  "Якщо є інші процеси, скажіть про це — це найсильніший аргумент у переговорах.",
  "Якщо базу не піднімають, просіть sign-on bonus або більший relocation package.",
  "Ризик після переїзду: якщо договір з HSM закінчується, часу на нового спонсора обмаль (кейс з Ейндговена — ~3 місяці; точні правила перевірте в IND). Тому стабільна компанія для першого оферу важливіша за максимальну зарплату.",
];

export const RULES: string[] = [
  "Жодного процесу без зарплати і спонсорства, з'ясованих на першому дзвінку.",
  "Не зупиняйте подачі, коли є фінальний етап. Зупиняєтесь лише після підписаного оферу.",
  "Після кожної співбесіди — 10 хвилин нотаток: питання, де застрягли, що покращити.",
  "Відмова — це дані, не оцінка вас. Просіть фідбек і йдіть до наступної.",
  "Паралельно готуйте документи: паспорти, військово-облікові дані, докази стосунків з партнером. Після оферу на це не буде часу.",
];

export const DAILY: string[] = [
  "30 хв: 1–2 цільові подачі з підлаштованим CV і листом.",
  "15 хв: 1–2 повідомлення про реферал або розмову.",
  "45 хв: навчання за таблицею технологій або підготовка до найближчої співбесіди.",
];

export const NOT_NOW = "Чого зараз не вчити: Kubernetes, мобільну розробку, нові фронтенд-фреймворки, глибокий Python-бекенд. Правило для CV: технологія потрапляє в Skills, лише коли ви готові 15 хвилин відповідати про неї і показати код.";

/** Only links known to be right: the guide's other sources were cited by name in the PDF, without their addresses. */
export const SOURCES: [string, string][] = [
  ["IND: Public register recognised sponsors", "https://ind.nl/en/public-register-recognised-sponsors/public-register-work"],
  ["Levels.fyi: salaries by company", "https://www.levels.fyi/"],
];
