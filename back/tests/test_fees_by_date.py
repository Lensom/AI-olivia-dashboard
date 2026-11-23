"""Finance: margin interest by day, for the dated list of fees. Run: python -m unittest discover -s tests"""

import unittest
from unittest.mock import patch

from app.broker.sync import Freedom24Source


class MarginInterestByDay(unittest.TestCase):
    def source(self, commissions):
        src = Freedom24Source(object())
        rates = {"USD": 1.0, "EUR": 1.1}
        with patch.object(Freedom24Source, "_commissions", lambda self: commissions), \
             patch.object(Freedom24Source, "_usd_rate", lambda self, cur, iso: rates.get(cur)):
            return src.margin_interest_rows(), src.margin_interest_usd()

    def test_one_row_a_day_in_usd_and_only_interest(self):
        rows, total = self.source([
            {"type": "Interest for negative balance", "datetime": "2026-03-02 00:00:00", "sum": "1.50", "currency": "USD"},
            {"type": "Interest for negative balance", "datetime": "2026-03-02 12:00:00", "sum": "1.00", "currency": "EUR"},
            {"type": "Interest for negative balance", "datetime": "2026-01-15 00:00:00", "sum": "0.40", "currency": "USD"},
            {"type": "For trade", "datetime": "2026-03-02 10:00:00", "sum": "5.00", "currency": "USD"},
            {"type": "Deposit fee", "datetime": "2026-03-02 10:00:00", "sum": "2.00", "currency": "USD"},
        ])
        self.assertEqual(rows, [{"date": "15.01.2026", "amount": "0.40"}, {"date": "02.03.2026", "amount": "2.60"}])
        self.assertAlmostEqual(total, 3.0)

    def test_nothing_charged_nothing_listed(self):
        self.assertEqual(self.source([{"type": "Interest", "datetime": "2026-01-01", "sum": "0.001", "currency": "USD"}]), ([], 0))


if __name__ == "__main__":
    unittest.main()
