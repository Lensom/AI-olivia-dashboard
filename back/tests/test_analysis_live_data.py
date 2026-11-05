"""The AI must see the account the pages show: the broker's numbers, the saved rows only as a fallback.
Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace
from unittest import mock

from app.investing import analysis

USER = SimpleNamespace(id=1, email="me@example.com")


def holding(ticker, shares, target="0.0%", industry="Tech"):
    return {
        "id": ticker,
        "ticker": ticker,
        "name": ticker,
        "industry": industry,
        "targetWeight": target,
        "currentWeight": "0%",
        "shares": shares,
        "avgBuyPrice": "100",
        "marketPrice": "100",
        "marketValue": "0",
        "pnl": "0",
        "trend": "",
    }


def trade(day, ticker="AAA"):
    return {"id": day, "type": "buy", "ticker": ticker, "count": 1, "price": "100", "currency": "USD", "amount": "100", "date": day}


class Saved:
    """The database, holding an out-of-date copy of the account."""

    tables = {
        "investing_holdings": (([holding("AAA", 1, target="50%"), holding("WANT", 0, target="7%")]), "2026-10-30"),
        "investing_broker": ({"cash": [{"id": "c", "currency": "USD", "amount": "350.13"}]}, "2026-10-30"),
        "investing_activities": ([trade("01.01.2020")], "2026-10-30"),
        "investing_refills": ([{"id": "r", "date": "01.01.2020", "amount": "111"}], "", "2026-10-30", "", []),
    }

    def execute(self, sql, params=None):
        for table, row in self.tables.items():
            if table in sql:
                return SimpleNamespace(fetchone=lambda row=row: row)
        return SimpleNamespace(fetchone=lambda: None)


class Broker:
    """Freedom24, as app/broker/sync.py presents it."""

    def holdings(self, saved):
        return [holding("AAA", 3, target="50%")]

    def cash(self):
        return [{"id": "f24-cash-USD", "currency": "USD", "amount": "844.98"}]

    def dividends(self):
        return []

    def activities(self, known=None):
        # Newest first, as the broker's list comes; 05.11 sorts before 28.01 as plain text.
        return [trade("05.11.2026"), trade("28.01.2026")]

    def refills(self):
        return [{"id": "f24", "date": "01.01.2026", "amount": "5000", "commission": "0"}]

    def margin_interest_usd(self):
        return 0.0


class BrokerDown(Broker):
    def holdings(self, saved):
        raise RuntimeError("HTTP 504")

    def cash(self):
        raise RuntimeError("HTTP 504")

    def activities(self, known=None):
        raise RuntimeError("HTTP 504")

    def refills(self):
        raise RuntimeError("HTTP 504")


class OnlyCashDown(Broker):
    def cash(self):
        raise RuntimeError("HTTP 504")


def quotes(rows, src=None):
    return [{**r, "current_price": "100.00", "day_change_pct": "0%"} for r in rows]


class LiveData(unittest.TestCase):
    def setUp(self):
        for name, value in (
            ("_enrich_picking_rows", quotes),
            ("_fetch_snapshot", lambda t: None),
            ("get_rates", lambda user: SimpleNamespace(to_usd={"USD": 1.0})),
        ):
            patcher = mock.patch.object(analysis, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def portfolio(self, source):
        facts, account, _ = analysis._gather_portfolio(Saved(), USER, lambda user: source)
        return facts, account

    def test_portfolio_review_uses_the_brokers_numbers(self):
        facts, account = self.portfolio(Broker())
        self.assertEqual(facts["account"]["cash"], "$844.98")
        self.assertEqual(facts["positions"][0]["value"], "$300.00")  # 3 shares from the broker, not the saved 1
        self.assertEqual(facts["account"]["money_deposited_total"], "$5,000.00")
        self.assertAlmostEqual(account, 1144.98)

    def test_broker_down_falls_back_to_the_saved_rows(self):
        facts, _ = self.portfolio(BrokerDown())
        self.assertEqual(facts["account"]["cash"], "$350.13")
        self.assertEqual(facts["positions"][0]["value"], "$100.00")

    def test_no_broker_connected_uses_the_saved_rows(self):
        facts, _ = self.portfolio(None)
        self.assertEqual(facts["account"]["cash"], "$350.13")

    def test_flagged_only_when_a_connected_broker_did_not_answer(self):
        self.assertIsNone(self.portfolio(Broker())[0]["broker_data_unavailable"])
        self.assertTrue(self.portfolio(BrokerDown())[0]["broker_data_unavailable"])
        self.assertIsNone(self.portfolio(None)[0]["broker_data_unavailable"])  # no broker: saved rows are the real data

    def test_one_failed_part_is_enough_to_flag(self):
        facts, _ = self.portfolio(OnlyCashDown())
        self.assertEqual(facts["account"]["cash"], "$350.13")
        self.assertTrue(facts["broker_data_unavailable"])

    def test_buy_check_and_one_ticker_carry_the_flag(self):
        self.assertFalse(analysis._stock_fit(Saved(), USER, "AAA", None, lambda user: Broker()).stale_data)
        self.assertTrue(analysis._stock_fit(Saved(), USER, "AAA", None, lambda user: BrokerDown()).stale_data)
        self.assertIsNone(analysis._gather(Saved(), USER, "AAA", lambda user: Broker())[0]["broker_data_unavailable"])
        self.assertTrue(analysis._gather(Saved(), USER, "AAA", lambda user: BrokerDown())[0]["broker_data_unavailable"])

    def test_buy_check_counts_the_brokers_cash(self):
        fit = analysis._stock_fit(Saved(), USER, "AAA", None, lambda user: Broker())
        self.assertEqual(fit.cash, 844.98)
        self.assertEqual(fit.shares, 3)

    def test_target_set_before_owning_the_stock_is_kept(self):
        fit = analysis._stock_fit(Saved(), USER, "WANT", None, lambda user: Broker())
        self.assertFalse(fit.owned)
        self.assertEqual(fit.target_weight, 7)

    def test_one_ticker_sees_live_position_and_trades_in_date_order(self):
        facts, _ = analysis._gather(Saved(), USER, "AAA", lambda user: Broker())
        self.assertEqual(facts["your_position"]["shares"], 3)
        self.assertEqual([t["date"] for t in facts["your_trades"]], ["28.01.2026", "05.11.2026"])


if __name__ == "__main__":
    unittest.main()
