/** Life pages: names and order shared by the sidebar, tabs and the backend defaults (back/app/categories/router.py). */
export const LIFE_PAGES = [
  { slug: "tasks", label: "Tasks" },
  { slug: "games", label: "Games" },
  { slug: "jobs", label: "Jobs" },
  { slug: "collection", label: "Collecting" },
];

export const lifePageHref = (slug: string) => (LIFE_PAGES.some((p) => p.slug === slug) ? `/life/${slug}` : `/c/life/${slug}`);
