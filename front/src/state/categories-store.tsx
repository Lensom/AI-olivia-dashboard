"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

export type Category = { id: number; name: string; slug: string };
export type Subcategory = { id: number; category_id: number; name: string; slug: string; sort_order?: number };

type CategoriesStore = {
  categories: Category[];
  subcategoriesByCategoryId: Record<number, Subcategory[]>;
  isLoading: boolean;
  isSubcategoriesLoadingByCategoryId: Record<number, boolean>;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<void>;
  refreshSubcategories: (categoryId: number) => Promise<void>;
  createSubcategory: (categoryId: number, name: string) => Promise<void>;
  reorderSubcategories: (categoryId: number, orderedIds: number[]) => Promise<void>;
};

const CategoriesContext = createContext<CategoriesStore | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [subcategoriesByCategoryId, setSubcategoriesByCategoryId] = useState<
    Record<number, Subcategory[]>
  >({});
  const [isSubcategoriesLoadingByCategoryId, setIsSubcategoriesLoadingByCategoryId] = useState<
    Record<number, boolean>
  >({});

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch<Category[]>("/categories", { token });
      setCategories(res);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const create = useCallback(
    async (name: string) => {
      if (!token) return;
      const created = await apiFetch<Category>("/categories", {
        token,
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCategories((prev) => [created, ...prev]);
    },
    [token],
  );

  const refreshSubcategories = useCallback(
    async (categoryId: number) => {
      if (!token) return;
      setIsSubcategoriesLoadingByCategoryId((prev) => ({ ...prev, [categoryId]: true }));
      try {
        const res = await apiFetch<Subcategory[]>(`/categories/${categoryId}/subcategories`, { token });
        setSubcategoriesByCategoryId((prev) => ({ ...prev, [categoryId]: res }));
      } catch {
        setSubcategoriesByCategoryId((prev) => ({ ...prev, [categoryId]: [] }));
      } finally {
        setIsSubcategoriesLoadingByCategoryId((prev) => ({ ...prev, [categoryId]: false }));
      }
    },
    [token],
  );

  const createSubcategory = useCallback(
    async (categoryId: number, name: string) => {
      if (!token) return;
      await apiFetch<Subcategory>(`/categories/${categoryId}/subcategories`, {
        token,
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await refreshSubcategories(categoryId);
    },
    [token, refreshSubcategories],
  );

  const reorderSubcategories = useCallback(
    async (categoryId: number, orderedIds: number[]) => {
      if (!token) return;
      const res = await apiFetch<Subcategory[]>(`/categories/${categoryId}/subcategories/reorder`, {
        token,
        method: "PUT",
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      setSubcategoriesByCategoryId((prev) => ({ ...prev, [categoryId]: res }));
    },
    [token],
  );

  useEffect(() => {
    if (!token) {
      setCategories([]);
      setSubcategoriesByCategoryId({});
      setIsSubcategoriesLoadingByCategoryId({});
      return;
    }
    refresh().catch(() => {});
  }, [token, refresh]);

  return (
    <CategoriesContext.Provider
      value={{
        categories,
        subcategoriesByCategoryId,
        isLoading,
        isSubcategoriesLoadingByCategoryId,
        refresh,
        create,
        refreshSubcategories,
        createSubcategory,
        reorderSubcategories,
      }}
    >
      {children}
    </CategoriesContext.Provider>
  );
}

export function useCategories() {
  const ctx = useContext(CategoriesContext);
  if (!ctx) throw new Error("useCategories must be used within CategoriesProvider");
  return ctx;
}

