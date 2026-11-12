"""Cinema → fixed years: a year's titles kept as they were, whatever is changed later. Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.cinema import router as cinema
from app.cinema.schemas import CinemaData, CinemaTitle


class Db:
    """cinema_titles for one user, with just the JSON operations the year endpoints use."""

    def __init__(self, data=None):
        self.data = data

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        if sql.startswith("SELECT data->'lists'"):
            return SimpleNamespace(fetchone=lambda: (self.data.get("lists"),) if self.data else None)
        if sql.startswith("SELECT data->'hidden_years'"):
            return SimpleNamespace(fetchone=lambda: (self.data.get("hidden_years"),) if self.data else None)
        if sql.startswith("UPDATE cinema_titles SET data = jsonb_set(data, '{hidden_years}'"):
            if self.data is None:
                return SimpleNamespace(fetchone=lambda: None)
            self.data["hidden_years"] = params[0].obj
            return SimpleNamespace(fetchone=lambda: (1,))
        if sql.startswith("SELECT data->'years'"):
            return SimpleNamespace(fetchone=lambda: (self.data.get("years"),) if self.data else None)
        if sql.startswith("INSERT INTO cinema_titles"):
            self.data = params[1].obj
            return SimpleNamespace(fetchone=lambda: ("now",))
        if sql.startswith("UPDATE cinema_titles SET data = jsonb_set(data, '{years}', COALESCE(data->'years', '{}'::jsonb) ||"):
            if self.data is None:
                return SimpleNamespace(fetchone=lambda: None)
            year, fixed, _ = params
            self.data.setdefault("years", {})[year] = fixed.obj
            return SimpleNamespace(fetchone=lambda: (1,))
        if sql.startswith("UPDATE cinema_titles SET data = jsonb_set(data, '{years}', COALESCE(data->'years', '{}'::jsonb) -"):
            year, _ = params
            (self.data or {}).get("years", {}).pop(year, None)
        return SimpleNamespace(fetchone=lambda: None)

    def commit(self):
        pass


USER = SimpleNamespace(id=1)


def title(i, view_year=2025, **kw):
    return CinemaTitle(id=f"t{i}", title=f"Film {i}", view_year=view_year, overview="Long text " * 50, actors=["A", "B"], **kw)


class FixedYears(unittest.TestCase):
    def test_fixing_keeps_the_titles_and_drops_the_heavy_text(self):
        db = Db({"items": [], "lists": []})
        fixed = cinema.fix_year(2025, [title(1), title(2)], USER, db)
        self.assertEqual([t.title for t in fixed.items], ["Film 1", "Film 2"])
        self.assertEqual((fixed.items[0].overview, fixed.items[0].actors), ("", []))
        self.assertIn("2025", db.data["years"])

    def test_saving_the_list_keeps_fixed_years(self):
        db = Db({"items": [], "lists": []})
        cinema.fix_year(2025, [title(1)], USER, db)
        # A rewatch moves Film 1 to 2026; the list is saved the usual way, without years.
        cinema.update_cinema(CinemaData(items=[title(1, view_year=2026)]), USER, db, "")
        self.assertEqual([t["title"] for t in db.data["years"]["2025"]["items"]], ["Film 1"])
        self.assertEqual(db.data["items"][0]["view_year"], 2026)

    def test_fixing_again_replaces_and_unfixing_removes(self):
        db = Db({"items": [], "lists": []})
        cinema.fix_year(2025, [title(1), title(2)], USER, db)
        cinema.fix_year(2025, [title(2)], USER, db)
        self.assertEqual([t["title"] for t in db.data["years"]["2025"]["items"]], ["Film 2"])
        cinema.unfix_year(2025, USER, db)
        self.assertNotIn("2025", db.data["years"])

    def test_hidden_years_are_cleaned_and_survive_saving_the_list(self):
        db = Db({"items": [], "lists": []})
        self.assertEqual(cinema.set_hidden_years([2023, 2021, 2022, 2021, 1200], USER, db), [2021, 2022, 2023])
        cinema.update_cinema(CinemaData(items=[title(1)]), USER, db, "")
        self.assertEqual(db.data["hidden_years"], [2021, 2022, 2023])
        self.assertEqual(db.data["items"][0]["view_year"], 2025)  # the titles keep their years

    def test_nothing_to_fix_without_a_list(self):
        with self.assertRaises(HTTPException) as caught:
            cinema.fix_year(2025, [title(1)], USER, Db(None))
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
