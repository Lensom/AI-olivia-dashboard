"""Life → Improvements: what a list accepts. Run: python -m unittest discover -s tests"""

import unittest

from pydantic import ValidationError

from app.improvements.router import Improvements


def doc(**item):
    return {"sections": [{"id": "health", "title": "Health", "groups": [{"id": "sleep", "emoji": "🛌", "title": "Sleep", "items": [{"id": "a", "name": "Routine", **item}]}]}]}


class Accepts(unittest.TestCase):
    def test_defaults(self):
        item = Improvements(**doc()).sections[0].groups[0].items[0]
        self.assertEqual((item.status, item.details, item.links, item.focus), ("todo", "", [], False))

    def test_the_three_statuses_only(self):
        for s in ("todo", "in_progress", "done"):
            self.assertEqual(Improvements(**doc(status=s)).sections[0].groups[0].items[0].status, s)
        with self.assertRaises(ValidationError):
            Improvements(**doc(status="maybe"))

    def test_only_web_links(self):
        self.assertEqual(Improvements(**doc(links=[" https://github.com/x ", ""])).sections[0].groups[0].items[0].links, ["https://github.com/x"])
        with self.assertRaises(ValidationError):
            Improvements(**doc(links=["javascript:alert(1)"]))

    def test_a_name_is_needed(self):
        with self.assertRaises(ValidationError):
            Improvements(**doc(name=""))


if __name__ == "__main__":
    unittest.main()
