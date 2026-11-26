"""Total → Spent by year: one figure per year, kept when an older tab saves without it.
Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace

from pydantic import ValidationError

from app.investing.router import update_total
from app.investing.schemas import InvestingTotalData

USER = SimpleNamespace(id=1)


class Conn:
    def __init__(self, saved_expenses=None):
        self.saved_expenses = saved_expenses
        self.written = None

    def execute(self, sql, params=None):
        if "data->'expenses'" in sql:
            return SimpleNamespace(fetchone=lambda: (self.saved_expenses,))
        if "INSERT INTO investing_total" in sql:
            self.written = params[1].obj
            return SimpleNamespace(fetchone=lambda: ("2026-11-26 10:00:00+00:00",))
        raise AssertionError(sql)

    def commit(self):
        pass


def year(y, amount, i=None):
    return {"id": i or f"y{y}", "year": y, "amount_uah": amount}


class SpentByYear(unittest.TestCase):
    def test_years_are_kept_oldest_first_one_row_each(self):
        conn = Conn()
        payload = InvestingTotalData(expenses=[year(2025, 1_989_123), year(2023, 1_051_133), year(2024, 1), year(2024, 1_179_021, "again")])
        res = update_total(payload, USER, conn)
        self.assertEqual([(e.year, e.amount_uah) for e in res.expenses], [(2023, 1_051_133), (2024, 1_179_021), (2025, 1_989_123)])
        self.assertEqual([e["year"] for e in conn.written["expenses"]], [2023, 2024, 2025])

    def test_a_tab_that_does_not_know_the_table_keeps_it(self):
        conn = Conn(saved_expenses=[year(2023, 1_051_133)])
        res = update_total(InvestingTotalData(accounts=[]), USER, conn)
        self.assertEqual([(e.year, e.amount_uah) for e in res.expenses], [(2023, 1_051_133)])

    def test_an_empty_table_sent_on_purpose_clears_it(self):
        conn = Conn(saved_expenses=[year(2023, 1_051_133)])
        res = update_total(InvestingTotalData(expenses=[]), USER, conn)
        self.assertEqual(res.expenses, [])

    def test_a_year_saved_while_the_table_was_in_dollars_is_still_read(self):
        conn = Conn(saved_expenses=[{"id": "y2023", "year": 2023, "amount_usd": 1_051_133}])
        res = update_total(InvestingTotalData(accounts=[]), USER, conn)
        self.assertEqual([(e.year, e.amount_uah) for e in res.expenses], [(2023, 1_051_133)])
        self.assertNotIn("amount_usd", conn.written["expenses"][0])

    def test_no_negative_amounts_or_odd_years(self):
        for bad in (year(2024, -1), year(1800, 10)):
            with self.assertRaises(ValidationError):
                InvestingTotalData(expenses=[bad])


if __name__ == "__main__":
    unittest.main()
