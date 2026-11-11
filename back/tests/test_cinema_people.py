"""Cinema → People: a director's or actor's released films from TMDB. Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace
from unittest import mock

from app import cache
from app.cinema import router as cinema
from app.cinema.schemas import CinemaPeopleRequest
from tests.test_cache import Table

SEARCH = {
    "Christopher Nolan": [
        {"id": 2, "name": "Christopher Nolan", "known_for_department": "Acting", "popularity": 50},  # a namesake actor, more popular
        {"id": 1, "name": "Christopher Nolan", "known_for_department": "Directing", "popularity": 10, "profile_path": "/n.jpg"},
    ],
    "Cillian Murphy": [{"id": 3, "name": "Cillian Murphy", "known_for_department": "Acting", "popularity": 30}],
}
CREDITS = {
    1: {"crew": [
        {"id": 27205, "title": "Inception", "job": "Director", "release_date": "2010-07-15", "vote_count": 37000},
        {"id": 27205, "title": "Inception", "job": "Writer", "release_date": "2010-07-15", "vote_count": 37000},
        {"id": 999, "title": "Batman Begins", "job": "Screenplay", "release_date": "2005-06-10", "vote_count": 21000},
        {"id": 888, "title": "Untitled Nolan", "job": "Director", "release_date": "2099-07-17", "vote_count": 0},
        {"id": 777, "title": "Following", "job": "Director", "release_date": "1998-09-12", "vote_count": 1500, "genre_ids": [80]},
        {"id": 666, "title": "Doodlebug", "job": "Director", "release_date": "1997-01-01", "vote_count": 514},
        {"id": 555, "title": "Tarantella", "job": "Director", "release_date": "1990-01-01", "vote_count": 57},
    ]},
    3: {"cast": [
        {"id": 872585, "title": "Oppenheimer", "release_date": "2023-07-19", "vote_count": 9000},
        {"id": 111, "title": "A tiny cameo", "release_date": "2005-01-01", "vote_count": 12},
    ]},
}


class People(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def tmdb(key, path, params):
            self.calls.append(path)
            if path == "/search/person":
                return {"results": SEARCH.get(params["query"], [])}
            return CREDITS[int(path.split("/")[2])]

        patches = [mock.patch.object(cinema, "_tmdb_get", tmdb), mock.patch.object(cinema, "_language", lambda conn, uid: "en-US")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        cache.use_pool(Table())
        self.addCleanup(cache.use_pool, None)

    def ask(self, names, role):
        return cinema.people(CinemaPeopleRequest(names=names, role=role), SimpleNamespace(id=1), None, "key")

    def test_a_director_is_found_over_a_better_known_namesake_and_only_directed_released_films_count(self):
        [p] = self.ask(["Christopher Nolan"], "director")
        self.assertEqual(p.tmdb_id, 1)
        # By votes; no screenplay, no future film, and no shorts hardly anyone saw (under 2% of Inception's votes).
        self.assertEqual([f.title for f in p.films], ["Inception", "Following"])
        self.assertTrue(p.profile.endswith("/n.jpg"))

    def test_an_actors_cameos_are_left_out(self):
        [p] = self.ask(["Cillian Murphy"], "actor")
        self.assertEqual([f.title for f in p.films], ["Oppenheimer"])

    def test_unknown_names_are_left_out(self):
        self.assertEqual(self.ask(["Nobody At All"], "director"), [])

    def test_the_second_time_comes_from_the_cache(self):
        self.ask(["Christopher Nolan"], "director")
        self.calls.clear()
        [p] = self.ask(["Christopher Nolan"], "director")
        self.assertEqual(self.calls, [])
        self.assertEqual(p.films[0].title, "Inception")

    def test_roles_are_cached_apart(self):
        self.ask(["Cillian Murphy"], "actor")
        self.calls.clear()
        self.ask(["Cillian Murphy"], "director")
        self.assertIn("/search/person", self.calls)

    def test_without_a_tmdb_key_nothing_is_asked(self):
        self.assertEqual(cinema.people(CinemaPeopleRequest(names=["X"], role="actor"), SimpleNamespace(id=1), None, ""), [])
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
