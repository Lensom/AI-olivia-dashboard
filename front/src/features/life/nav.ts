/** Life pages: names and order shared by the sidebar, tabs and the backend defaults (back/app/categories/router.py). */
export const LIFE_PAGES = [
  { slug: "tasks", label: "Tasks" },
  { slug: "games", label: "Games" },
  { slug: "career", label: "Career" },
  { slug: "collection", label: "Collecting" },
  { slug: "places", label: "Must visit" },
];

/** Pages that became part of another: a menu entry left over from before still goes to the right place. */
const MOVED: Record<string, string> = { jobs: "/life/career/jobs" };

export const lifePageHref = (slug: string) => MOVED[slug] ?? (LIFE_PAGES.some((p) => p.slug === slug) ? `/life/${slug}` : `/c/life/${slug}`);
