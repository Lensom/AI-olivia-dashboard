"""Section menus: brought up to date from the rows already read, with no queries when nothing changed.
Run: python -m unittest discover -s tests"""

import unittest

from app.categories.router import _DEFAULTS, _ensure_defaults


class FakeConn:
    def __init__(self):
        self.sql: list[str] = []
        self.inserted: list[tuple] = []

    def execute(self, sql, params=None):
        self.sql.append(" ".join(sql.split()))

    def cursor(self):
        conn = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def executemany(self, sql, rows):
                conn.sql.append("INSERT many")
                conn.inserted.extend(rows)

        return Cursor()


def rows_for(slug, order=10):
    return [(i + 1, 7, name, s, order * (i + 1)) for i, (name, s) in enumerate(_DEFAULTS[slug])]


def run(slug, rows):
    conn = FakeConn()
    changed = _ensure_defaults(conn, user_id=1, category_id=7, slug=slug, rows=rows)
    return conn, changed


class Defaults(unittest.TestCase):
    def test_an_up_to_date_menu_costs_no_queries(self):
        for slug in _DEFAULTS:
            conn, changed = run(slug, rows_for(slug))
            self.assertEqual((conn.sql, changed), ([], False), slug)

    def test_a_category_without_defaults_is_left_alone(self):
        conn, changed = run("my-own", [(1, 7, "Stuff", "stuff", 10)])
        self.assertEqual((conn.sql, changed), ([], False))

    def test_missing_defaults_go_in_one_batch_after_the_last(self):
        rows = rows_for("library")[:2]  # books 10, comics 20
        conn, changed = run("library", rows)
        self.assertTrue(changed)
        self.assertEqual(conn.sql, ["INSERT many"])
        self.assertEqual([(r[3], r[4]) for r in conn.inserted], [("manga", 30), ("magazines", 40), ("achievements", 50), ("series", 60), ("tops", 70)])

    def test_a_new_section_gets_its_whole_menu(self):
        conn, _ = run("life", [])
        self.assertEqual([r[3] for r in conn.inserted], ["tasks", "games", "career", "collection", "places", "improvements"])

    def test_the_old_jobs_entry_goes(self):
        conn, changed = run("life", [*rows_for("life"), (99, 7, "Jobs", "jobs", 50)])
        self.assertTrue(changed)
        self.assertEqual(len(conn.sql), 1)
        self.assertIn("DELETE FROM subcategories", conn.sql[0])

    def test_old_tv_shows_becomes_series_and_tv_shows_is_added_again(self):
        rows = [r for r in rows_for("cinematography") if r[3] != "series"]
        rows = [(r[0], r[1], "TV shows", r[3], r[4]) if r[3] == "tv-shows" else r for r in rows]
        conn, _ = run("cinematography", rows)
        self.assertIn("SET name = 'Series', slug = 'series'", conn.sql[0])
        self.assertEqual([r[3] for r in conn.inserted], ["tv-shows"])

    def test_old_investing_names_are_renamed_but_yours_are_kept(self):
        rows = [(r[0], r[1], {"dashboard": "Dashboard", "table": "My money"}.get(r[3], r[2]), r[3], r[4]) for r in rows_for("investing")]
        conn, _ = run("investing", rows)
        self.assertEqual(len(conn.sql), 1)  # Dashboard -> Overview; "My money" stays

    def test_rows_without_an_order_get_one(self):
        conn, changed = run("life", rows_for("life", order=0))
        self.assertTrue(changed)
        self.assertIn("ROW_NUMBER()", conn.sql[0])


class WholeMenu(unittest.TestCase):
    def test_reads_everything_in_two_queries_when_up_to_date(self):
        from types import SimpleNamespace

        from app.categories.router import list_all_subcategories

        life = [(i + 1, 3, name, s, 10 * (i + 1)) for i, (name, s) in enumerate(_DEFAULTS["life"])]
        queries = []

        def execute(sql, params=None):
            queries.append(sql)
            if "FROM categories" in sql:
                return SimpleNamespace(fetchall=lambda: [(3, "life"), (5, "my-own")])
            return SimpleNamespace(fetchall=lambda: life)

        menu = list_all_subcategories(SimpleNamespace(id=1), SimpleNamespace(execute=execute))
        self.assertEqual(len(queries), 2)
        self.assertEqual([s.slug for s in menu[3]], ["tasks", "games", "career", "collection", "places", "improvements"])
        self.assertEqual(menu[5], [])


if __name__ == "__main__":
    unittest.main()
