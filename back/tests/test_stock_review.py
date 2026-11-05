"""The stock page's buy checks and Yahoo parsing. Run: python -m unittest discover -s tests"""

import unittest

from pydantic import ValidationError

from app.investing.analysis import StockReview, compute_fit
from app.investing.stock import Financials, Point, _parse_financials, _parse_insiders, build_detail


def row(strong="100", may="120", bucket="value_blue_chips"):
    return {"strong_buy_until": strong, "may_buy_until": may, "bucket": bucket}


def pos(ticker, value, bucket="value_blue_chips", sector="Technology", shares=1.0):
    return {"ticker": ticker, "value": value, "bucket": bucket, "industry": "Tech", "sector": sector, "shares": shares}


class PriceZone(unittest.TestCase):
    def zone(self, price, r):
        return compute_fit("AAA", price, r, [], None, None).zone

    def test_zones(self):
        self.assertEqual(self.zone(90, row()), "strong")
        self.assertEqual(self.zone(100, row()), "strong")
        self.assertEqual(self.zone(110, row()), "may")
        self.assertEqual(self.zone(130, row()), "above")

    def test_no_levels_is_unset_not_above(self):
        self.assertEqual(self.zone(130, row(strong="", may="")), "unset")
        self.assertEqual(self.zone(130, None), "unset")


class Room(unittest.TestCase):
    def test_room_to_target_counts_the_cash(self):
        # Account 10,000 (9,000 invested + 1,000 cash): a 10% target is 1,000; holding 500 leaves 500.
        fit = compute_fit("AAA", 100, row(), [pos("AAA", 500), pos("BBB", 8500)], 10, 1000)
        self.assertEqual((fit.room, fit.room_basis), ("room", "target"))
        self.assertEqual(fit.room_usd, 500)
        self.assertEqual(fit.max_buy_usd, 500)
        self.assertEqual(fit.max_buy_shares, 5)

    def test_cash_caps_the_buy(self):
        fit = compute_fit("AAA", 100, row(), [pos("AAA", 500), pos("BBB", 9300)], 10, 200)
        self.assertEqual(fit.max_buy_usd, 200)
        self.assertEqual(fit.max_buy_shares, 2)

    def test_at_target_is_full(self):
        fit = compute_fit("AAA", 100, row(), [pos("AAA", 1000), pos("BBB", 9000)], 10, 0)
        self.assertEqual((fit.room, fit.full_reason), ("full", "target"))
        self.assertIsNone(fit.max_buy_usd)

    def test_over_target_is_full_even_with_cash_waiting(self):
        # 18% of the invested money against a 15% target: counting the cash must not make room appear.
        fit = compute_fit("AAA", 100, row(), [pos("AAA", 1800), pos("BBB", 8200)], 15, 5000)
        self.assertEqual((fit.room, fit.full_reason), ("full", "target"))
        self.assertIsNone(fit.max_buy_usd)

    def test_over_bucket_share_is_full_even_with_cash_waiting(self):
        fit = compute_fit("NEW", 100, row(), [pos("BBB", 5000), pos("ETF", 5000, bucket="etf_reit_fund")], None, 90000)
        self.assertEqual((fit.room, fit.full_reason), ("full", "bucket_weight"))

    def test_without_a_target_the_bucket_decides(self):
        fit = compute_fit("NEW", 100, row(), [pos("BBB", 3000), pos("ETF", 6000, bucket="etf_reit_fund")], None, 1000)
        self.assertEqual((fit.room, fit.room_basis), ("room", "bucket"))
        self.assertEqual(fit.room_usd, 1000)  # 40% of 10,000 minus the 3,000 already in the bucket
        self.assertEqual(fit.bucket_positions, 1)

    def test_a_full_bucket_blocks_only_new_positions(self):
        held = [pos(f"T{i}", 100) for i in range(10)] + [pos("ETF", 9000, bucket="etf_reit_fund")]
        new = compute_fit("NEW", 100, row(), held, None, 5000)
        self.assertEqual((new.room, new.full_reason), ("full", "bucket_positions"))
        self.assertEqual(compute_fit("T0", 100, row(), held, None, 5000).room, "room")

    def test_nothing_to_compare_with(self):
        fit = compute_fit("AAA", 100, None, [], None, None)
        self.assertEqual((fit.room, fit.room_basis), ("unknown", "none"))


def review(verdict):
    return {
        "verdict": verdict,
        "confidence": "high",
        "headline": "h",
        "company_health": "solid",
        "company_state": "c",
        "valuation": "v",
        "price_check": "p",
        "portfolio_check": "f",
        "strengths": ["a"],
        "risks": ["b"],
        "action": "x",
        "change_mind": "y",
    }


class ModelCannotOverruleYourRules(unittest.TestCase):
    def check(self, verdict, zone, room):
        return StockReview.model_validate(review(verdict), context={"zone": zone, "room": room})

    def test_no_buy_above_your_levels(self):
        for verdict in ("buy", "buy_partial"):
            with self.assertRaises(ValidationError):
                self.check(verdict, "above", "room")

    def test_no_buy_without_room(self):
        with self.assertRaises(ValidationError):
            self.check("buy", "strong", "full")

    def test_buy_allowed_when_both_pass(self):
        self.assertEqual(self.check("buy", "may", "room").verdict, "buy")
        self.assertEqual(self.check("buy", "unset", "unknown").verdict, "buy")

    def test_may_always_refuse(self):
        self.assertEqual(self.check("avoid", "strong", "room").verdict, "avoid")


class YahooParsing(unittest.TestCase):
    def test_financials_skip_gaps_and_sort(self):
        quarterly, annual = _parse_financials([
            {"meta": {"type": ["quarterlyTotalRevenue"]}, "quarterlyTotalRevenue": [
                {"asOfDate": "2026-06-30", "reportedValue": {"raw": 2}},
                None,
                {"asOfDate": "2026-03-31", "reportedValue": {"raw": 1}},
            ]},
            {"meta": {"type": ["annualDilutedEPS"]}, "annualDilutedEPS": [{"asOfDate": "2025-09-30", "reportedValue": {"raw": 7.46}}]},
        ])
        self.assertEqual([p.value for p in quarterly.revenue], [1, 2])
        self.assertEqual(annual.eps[0].value, 7.46)

    def test_insiders_keep_recent_buys_and_sales_only(self):
        now = 2_000_000_000

        def tx(text, age):
            return {"transactionText": text, "startDate": {"raw": now - age}, "filerName": "DOE JANE", "value": {"raw": 5}}

        trades = _parse_insiders({"insiderTransactions": {"transactions": [
            tx("Sale at price 10", 100),
            tx("Purchase at price 9", 200),
            tx("Stock Gift at price 0", 300),
            tx("", 300),
            tx("Sale at price 8", 400 * 86400),
        ]}}, now)
        self.assertEqual([t.kind for t in trades], ["sell", "buy"])
        self.assertEqual(trades[0].name, "Doe Jane")

    def test_no_yield_across_currencies(self):
        quarterly = Financials(fcf=[Point(period=f"2026-0{i}-01", value=100) for i in range(1, 5)])
        summary = {"price": {"currency": "USD"}, "financialData": {"financialCurrency": "TWD"}, "summaryDetail": {"marketCap": {"raw": 1000}}}
        self.assertIsNone(build_detail("TSM", summary, (quarterly, Financials()), None, 0).stats.fcf_yield)
        summary["financialData"]["financialCurrency"] = "USD"
        self.assertEqual(build_detail("X", summary, (quarterly, Financials()), None, 0).stats.fcf_yield, 40)

    def test_unknown_ticker(self):
        self.assertIsNone(build_detail("NOPE", None, None, None, 0))


if __name__ == "__main__":
    unittest.main()
