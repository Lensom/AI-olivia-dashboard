"""Life → Purchases: what a list accepts. Run: python -m unittest discover -s tests"""

import unittest

from pydantic import ValidationError

from app.purchases.router import Purchases


def doc(**item):
    return {"lists": [{"id": "tech", "title": "Tech", "items": [{"id": "a", "title": "Mouse", **item}]}]}


def first(d):
    return Purchases(**d).lists[0].items[0]


class Accepts(unittest.TestCase):
    def test_defaults(self):
        item = first(doc())
        self.assertEqual((item.bought, item.planned, item.paid, item.currency, item.url), (False, None, None, "UAH", ""))
        self.assertEqual(Purchases(**doc()).lists[0].currency, "UAH")

    def test_each_item_keeps_its_own_currency(self):
        d = {"lists": [{"id": "tech", "title": "Tech", "items": [
            {"id": "a", "title": "Chair", "paid": 14999, "currency": "UAH"},
            {"id": "b", "title": "TV", "paid": 2000, "currency": "RON"},
            {"id": "c", "title": "Comic", "paid": 10.81, "currency": "EUR"},
        ]}]}
        self.assertEqual([(i.currency, i.paid) for i in Purchases(**d).lists[0].items], [("UAH", 14999), ("RON", 2000), ("EUR", 10.81)])
        with self.assertRaises(ValidationError):
            first(doc(currency="BTC"))

    def test_a_gift_costs_zero_but_a_price_is_never_negative(self):
        self.assertEqual(first(doc(paid=0)).paid, 0)
        with self.assertRaises(ValidationError):
            first(doc(planned=-1))

    def test_only_web_links(self):
        self.assertEqual(first(doc(url=" https://rozetka.com.ua/x ")).url, "https://rozetka.com.ua/x")
        with self.assertRaises(ValidationError):
            first(doc(url="javascript:alert(1)"))

    def test_a_title_is_needed(self):
        for blank in ("", "   "):
            with self.assertRaises(ValidationError):
                first(doc(title=blank))


if __name__ == "__main__":
    unittest.main()
