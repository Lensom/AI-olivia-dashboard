"""The Postgres cache for slow public answers, and the series and collections that use it.
Run: python -m unittest discover -s tests"""

import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from app import cache
from app.cinema import router as cinema
from app.library import series
from app.library.schemas import LibrarySeries, LibrarySeriesPart


class Table:
    """Just enough of api_cache: rows by key, with when they were stored."""

    def __init__(self, fail=False):
        self.rows = {}
        self.fail = fail
        self.now = datetime.now(timezone.utc)

    @contextmanager
    def connection(self):
        if self.fail:
            raise RuntimeError("database down")
        table = self

        class Cur:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

            def executemany(self, sql, rows):
                for key, value in rows:
                    table.rows[key] = (value.obj, table.now)

        def execute(sql, params=()):
            if sql.lstrip().startswith("SELECT"):
                keys, since = params
                return SimpleNamespace(fetchall=lambda: [(k, table.rows[k][0]) for k in keys if k in table.rows and table.rows[k][1] > since])
            return SimpleNamespace()

        yield SimpleNamespace(execute=execute, cursor=lambda: Cur(), commit=lambda: None)


class Cache(unittest.TestCase):
    def tearDown(self):
        cache.use_pool(None)

    def test_without_a_database_nothing_is_found_and_nothing_breaks(self):
        cache.use_pool(None)
        cache.put_many({"a": 1})
        self.assertEqual(cache.get_many(["a"], timedelta(days=1)), {})

    def test_stores_and_finds_values_including_none(self):
        cache.use_pool(Table())
        cache.put_many({"a": {"x": 1}, "b": None})
        self.assertEqual(cache.get_many(["a", "b", "c"], timedelta(days=1)), {"a": {"x": 1}, "b": None})

    def test_old_values_are_misses(self):
        table = Table()
        cache.use_pool(table)
        cache.put_many({"a": 1})
        table.rows["a"] = (table.rows["a"][0], table.now - timedelta(days=2))
        self.assertEqual(cache.get_many(["a"], timedelta(days=1)), {})

    def test_a_database_failure_is_a_miss_not_an_error(self):
        cache.use_pool(Table(fail=True))
        cache.put_many({"a": 1})
        self.assertEqual(cache.get_many(["a"], timedelta(days=1)), {})


def a_series(sid="Q1"):
    part = LibrarySeriesPart(wikidata_id="Q10", title="Book one")
    return LibrarySeries(id=sid, name="Saga", parts=[part, part.model_copy(update={"wikidata_id": "Q11", "title": "Book two"})])


class SeriesFromTheDatabase(unittest.TestCase):
    def setUp(self):
        series._series_cache.clear()
        series._series_locks.clear()
        self.table = Table()
        cache.use_pool(self.table)
        self.addCleanup(cache.use_pool, None)

    def test_a_series_built_once_is_read_back_after_a_restart(self):
        with mock.patch.object(series, "_build_series", side_effect=lambda sid, lang: series.cache.put_many({series._db_key(sid, lang): a_series(sid).model_dump()}) or a_series(sid)) as build:
            first = series.series_parts(["Q1"], None, "uk")
        series._series_cache.clear()  # the server restarted
        with mock.patch.object(series, "_build_series") as build_again:
            second = series.series_parts(["Q1"], None, "uk")
        self.assertEqual(build.call_count, 1)
        build_again.assert_not_called()
        self.assertEqual([s.name for s in second], [s.name for s in first])

    def test_not_a_series_is_remembered_too(self):
        cache.put_many({series._db_key("Q2", "uk"): None})
        with mock.patch.object(series, "_build_series") as build:
            self.assertEqual(series.series_parts(["Q2"], None, "uk"), [])
        build.assert_not_called()

    def test_languages_are_kept_apart(self):
        cache.put_many({series._db_key("Q1", "uk"): a_series().model_dump()})
        with mock.patch.object(series, "_build_series", return_value=None) as build:
            series.series_parts(["Q1"], None, "en")
        build.assert_called_once_with("Q1", "en")


class CollectionsFromTheDatabase(unittest.TestCase):
    def setUp(self):
        self.table = Table()
        cache.use_pool(self.table)
        self.addCleanup(cache.use_pool, None)
        patcher = mock.patch.object(cinema, "_language", return_value="uk-UA")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.fetched = []

        def tmdb(key, path, params):
            self.fetched.append(path)
            cid = int(path.rsplit("/", 1)[1])
            if cid == 404:
                raise cinema.HTTPException(status_code=404, detail="nope")
            return {"name": f"Saga {cid} Collection", "parts": [{"id": cid * 10, "title": "One", "release_date": "2001-01-01"}]}

        patcher = mock.patch.object(cinema, "_tmdb_get", tmdb)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, ids):
        return cinema.collections(ids, SimpleNamespace(id=1), None, "key")

    def test_second_time_nothing_is_asked_from_tmdb(self):
        first = self.call([1, 2])
        self.fetched.clear()
        second = self.call([2, 1])
        self.assertEqual(self.fetched, [])
        self.assertEqual([c.id for c in second], [2, 1])
        self.assertEqual(second[0].name, first[1].name)

    def test_only_the_missing_ones_are_fetched_and_failures_are_not_stored(self):
        self.call([1])
        self.fetched.clear()
        result = self.call([1, 404, 3])
        self.assertEqual(sorted(self.fetched), ["/collection/3", "/collection/404"])
        self.assertEqual([c.id for c in result], [1, 3])
        self.assertNotIn("tmdb:collection:404:uk-UA", self.table.rows)


if __name__ == "__main__":
    unittest.main()
