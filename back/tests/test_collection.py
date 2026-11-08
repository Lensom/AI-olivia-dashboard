"""Life → Collecting: what the backend accepts and how it saves. Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace

from pydantic import ValidationError

from app.collection.router import Collection, get_collection, save_collection


def line(**kw):
    return {"id": "a1", "title": "Marvel Epic Collection", **kw}


def collection(*items, **category):
    return {"categories": [{"id": "c1", "name": "Comics", "items": list(items), **category}]}


class Accepts(unittest.TestCase):
    def test_a_full_collection(self):
        data = collection(line(
            status="collecting", note="1960–2000", url="https://example.com/epic", count=60, goal=100,
            wishes=[{"id": "w1", "title": "Vol. 12", "price": 1450.5, "currency": "UAH", "url": "https://shop.example/12"}],
            children=[{"id": "k1", "title": "Stephen King", "status": "done"}],
        ))
        saved = Collection(**data)
        item = saved.categories[0].items[0]
        self.assertEqual((item.status, item.count, item.children[0].title, item.wishes[0].bought), ("collecting", 60, "Stephen King", False))

    def test_defaults(self):
        item = Collection(**collection(line())).categories[0].items[0]
        self.assertEqual((item.status, item.url, item.count, item.goal, item.children, item.wishes), ("idea", "", None, None, [], []))


class Refuses(unittest.TestCase):
    def refuse(self, data):
        with self.assertRaises(ValidationError):
            Collection(**data)

    def test_a_link_that_isnt_a_web_link(self):
        for bad in ("javascript:alert(1)", "data:text/html,x", "ftp://x.example", "https://x.example/a b"):
            self.refuse(collection(line(url=bad)))
            self.refuse(collection(line(wishes=[{"id": "w1", "title": "x", "url": bad}])))

    def test_an_unknown_status_or_currency(self):
        self.refuse(collection(line(status="maybe")))
        self.refuse(collection(line(wishes=[{"id": "w1", "title": "x", "currency": "GBP"}])))

    def test_sub_lines_have_no_sub_lines_of_their_own(self):
        item = Collection(**collection(line(children=[{"id": "k1", "title": "King", "children": [{"id": "z", "title": "Deeper"}]}]))).categories[0].items[0]
        self.assertFalse(hasattr(item.children[0], "children"))

    def test_empty_names_bad_ids_and_negative_numbers(self):
        self.refuse(collection(line(title="")))
        self.refuse(collection(line(), name=""))
        self.refuse(collection(line(id="has space")))
        self.refuse(collection(line(count=-1)))
        self.refuse(collection(line(goal=0)))
        self.refuse(collection(line(wishes=[{"id": "w1", "title": "x", "price": -5}])))


class Conn:
    def __init__(self, row=None):
        self.row = row
        self.saved = None

    def execute(self, sql, params=None):
        if sql.lstrip().startswith("INSERT"):
            self.saved = params
            return SimpleNamespace(fetchone=lambda: ("2026-11-08 10:00:00+00",))
        return SimpleNamespace(fetchone=lambda: self.row)

    def commit(self):
        pass


USER = SimpleNamespace(id=7)


class Storage(unittest.TestCase):
    def test_nothing_saved_yet_is_an_empty_collection(self):
        self.assertEqual(get_collection(USER, Conn()).categories, [])

    def test_saves_for_this_user_and_reads_back(self):
        conn = Conn()
        save_collection(Collection(**collection(line())), USER, conn)
        self.assertEqual(conn.saved[0], 7)
        stored = conn.saved[1].obj
        read = get_collection(USER, Conn((stored, "2026-11-08")))
        self.assertEqual(read.categories[0].items[0].title, "Marvel Epic Collection")


if __name__ == "__main__":
    unittest.main()
