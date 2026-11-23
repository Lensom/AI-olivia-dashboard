"""Life → Must visit: the starting list, what a list accepts, and pictures from Wikipedia. Run: python -m unittest discover -s tests"""

import json
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.places import router as places
from app.places.router import PlaceIdeas, Places, _fetch_batch, _opening
from app.places.seed import SUGGESTIONS, starting_list, suggestion_id


class StartingList(unittest.TestCase):
    def test_is_the_whole_list_and_valid(self):
        data = Places(**starting_list())
        items = [p for c in data.categories for p in c.items]
        self.assertEqual([len(c.items) for c in data.categories], [5, 16, 16, 21, 9, 12])
        self.assertEqual(sum(p.visited for p in items), 17)
        self.assertEqual(len({p.id for p in items}), len(items), "ids are unique")
        self.assertTrue(all(p.wiki for p in items))

    def test_ideas_are_not_already_on_the_list(self):
        wikis = {p["wiki"] for c in starting_list()["categories"] for p in c["items"]}
        cats = {c["id"] for c in starting_list()["categories"]}
        for cat, _, _, wiki in SUGGESTIONS:
            self.assertNotIn(wiki, wikis)
            self.assertIn(cat, cats)
        self.assertEqual(len({suggestion_id(w) for *_, w in SUGGESTIONS}), len(SUGGESTIONS))


class Accepts(unittest.TestCase):
    def place(self, **kw):
        return {"categories": [{"id": "c", "title": "C", "items": [{"id": "p", "name": "X", **kw}]}]}

    def test_a_missing_location_is_empty(self):
        self.assertEqual(Places(**self.place(location=None)).categories[0].items[0].location, "")

    def test_only_web_links_as_pictures(self):
        with self.assertRaises(ValidationError):
            Places(**self.place(image="javascript:alert(1)"))
        self.assertEqual(Places(**self.place(image="https://x.example/a.jpg")).categories[0].items[0].image, "https://x.example/a.jpg")


class FakeWiki:
    """Answers _query by what is asked: the English batch, the coordinates retry, the Ukrainian info and openings."""

    def __init__(self, en, coords=None, uk=None, extracts=None, fail=()):
        self.en, self.coords, self.uk, self.extracts, self.fail = en, coords or {}, uk or {}, extracts or {}, set(fail)
        self.calls = []

    def __call__(self, host, params):
        kind = "en" if host.startswith("en") and "langlinks" in params["prop"] else "coords" if host.startswith("en") else "extracts" if params["prop"] == "extracts" else "uk"
        self.calls.append(kind)
        if kind in self.fail:
            return None
        return {"en": self.en, "coords": self.coords, "uk": self.uk, "extracts": self.extracts}[kind]


class Pictures(unittest.TestCase):
    def test_follows_renames_back_to_the_title_asked_for(self):
        en = {
            "normalized": [{"from": "moai", "to": "Moai"}],
            "redirects": [{"from": "Moai", "to": "Moai statues"}],
            "pages": [
                {"title": "Moai statues", "fullurl": "https://en.wikipedia.org/wiki/Moai_statues", "description": "Statues",
                 "thumbnail": {"source": "https://upload.wikimedia.org/x/640px-M.jpg"}, "coordinates": [{"lat": -27.1, "lon": -109.3}]},
                {"title": "Nowhere", "missing": True},
            ],
        }
        with patch.object(places, "_query", FakeWiki(en)):
            got = _fetch_batch(["moai", "Nowhere"])
        self.assertEqual(got["moai"]["image"], "https://upload.wikimedia.org/x/640px-M.jpg")
        self.assertEqual((got["moai"]["lat"], got["moai"]["lon"]), (-27.1, -109.3))
        self.assertEqual(got["Nowhere"], {})

    def test_coordinates_not_marked_primary_are_found_too(self):
        en = {"pages": [{"title": "Petra", "fullurl": "u"}]}
        coords = {"pages": [{"title": "Petra", "coordinates": [{"lat": 1.0, "lon": 2.0, "globe": "moon"}, {"lat": 30.3, "lon": 35.4, "globe": "earth"}]}]}
        with patch.object(places, "_query", FakeWiki(en, coords=coords)):
            got = _fetch_batch(["Petra"])
        self.assertEqual((got["Petra"]["lat"], got["Petra"]["lon"]), (30.3, 35.4))

    def test_ukrainian_description_or_else_the_opening_of_the_article(self):
        en = {"pages": [
            {"title": "Eiffel Tower", "fullurl": "u", "coordinates": [{"lat": 48.8, "lon": 2.3}], "langlinks": [{"lang": "uk", "title": "Ейфелева вежа"}]},
            {"title": "Hallstatt", "fullurl": "u", "coordinates": [{"lat": 47.5, "lon": 13.6}], "langlinks": [{"lang": "uk", "title": "Гальштат"}]},
        ]}
        uk = {"pages": [
            {"title": "Ейфелева вежа", "fullurl": "https://uk.wikipedia.org/wiki/E", "description": "символ Парижа"},
            {"title": "Гальштат", "fullurl": "https://uk.wikipedia.org/wiki/H"},
        ]}
        extracts = {"pages": [{"title": "Гальштат", "extract": "Га́льштат (нім. Hallstatt) — ярмаркова громада в Австрії. Відома озером."}]}
        fake = FakeWiki(en, uk=uk, extracts=extracts)
        with patch.object(places, "_query", fake):
            got = _fetch_batch(["Eiffel Tower", "Hallstatt"])
        self.assertEqual(got["Eiffel Tower"]["uk_description"], "символ Парижа")
        self.assertEqual(got["Eiffel Tower"]["uk_url"], "https://uk.wikipedia.org/wiki/E")
        self.assertEqual(got["Hallstatt"]["uk_description"], "Гальштат — ярмаркова громада в Австрії.")
        self.assertNotIn("coords", fake.calls)  # everything had coordinates already
        self.assertFalse(any(v.get("partial") for v in got.values()))

    def test_a_failed_later_step_is_shown_but_marked_partial(self):
        en = {"pages": [{"title": "X", "fullurl": "u", "thumbnail": {"source": "p"}, "coordinates": [{"lat": 1, "lon": 2}], "langlinks": [{"lang": "uk", "title": "Ікс"}]}]}
        with patch.object(places, "_query", FakeWiki(en, fail={"uk"})):
            got = _fetch_batch(["X"])
        self.assertEqual(got["X"]["image"], "p")
        self.assertTrue(got["X"]["partial"])

    def test_nothing_when_wikipedia_does_not_answer(self):
        with patch.object(places, "_query", FakeWiki({}, fail={"en"})):
            self.assertIsNone(_fetch_batch(["X"]))

    def test_opening_reads_well(self):
        self.assertEqual(_opening("Е́йфелева ве́жа (фр. Tour Eiffel) — металева вежа в центрі Парижа, м. Париж. Друге речення."),
                         "Ейфелева вежа — металева вежа в центрі Парижа, м. Париж.")


class Countries(unittest.TestCase):
    def test_codes_only(self):
        self.assertEqual(Places(countries=["FR", "UA"]).countries, ["FR", "UA"])
        for bad in (["fr"], ["France"], ["F"]):
            with self.assertRaises(ValidationError):
                Places(countries=bad)


class Ideas(unittest.TestCase):
    def ideas(self, n=8, **over):
        base = [{"category": "nature", "name": f"Місце {i}", "location": "Країна", "wiki": f"Place {i}", "reason": "Як і скелі Етрета."} for i in range(n)]
        if over:
            base[0] = {**base[0], **over}
        return json.dumps({"ideas": base})

    def check(self, text, lang="uk"):
        return PlaceIdeas.model_validate_json(text, context={"lang": lang, "categories": {"nature", "cities"}, "taken": {"eiffel tower"}})

    def test_good_ideas_pass(self):
        self.assertEqual(len(self.check(self.ideas()).ideas), 8)

    def test_sent_back_for_repair(self):
        for text in (self.ideas(n=3), self.ideas(category="space"), self.ideas(wiki="Eiffel Tower"), self.ideas(name="Lake", reason="Because.")):
            with self.assertRaises(ValidationError):
                self.check(text)
        doubled = json.loads(self.ideas())
        doubled["ideas"][1]["wiki"] = doubled["ideas"][0]["wiki"]
        with self.assertRaises(ValidationError):
            self.check(json.dumps(doubled))


if __name__ == "__main__":
    unittest.main()
