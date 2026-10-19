/**
 * Sections that are built but hidden for now. A hidden category doesn't show in the sidebar or on Home,
 * and its pages show "not found". Its data and backend stay as they are.
 */
export const HIDDEN_CATEGORIES = new Set(["life"]);

export const isCategoryVisible = (slug: string) => !HIDDEN_CATEGORIES.has(slug);
