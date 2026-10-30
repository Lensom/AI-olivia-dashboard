/** Built-in categories with their own routes; any other category lives under /c/<slug>. */
const ROUTES: Record<string, string> = {
  investing: "/investing",
  cinematography: "/cinematography",
  library: "/library",
  life: "/life",
};

export const categoryHref = (slug: string) => ROUTES[slug] ?? `/c/${slug}`;
