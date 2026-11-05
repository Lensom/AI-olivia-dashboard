"""Portfolio advice: fund overlap arithmetic and what the model may claim. Run: python -m unittest discover -s tests"""

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from pydantic import ValidationError

from app.investing.analysis import PortfolioAdvice, PortfolioAnalysis, PortfolioQuestion, fund_overlaps, get_portfolio_analysis, stocks_inside_funds
from app.investing.stock import FundHolding, _parse_fund_holdings


def fund(**weights):
    return [FundHolding(symbol=s, weight=w) for s, w in weights.items()]


class Overlap(unittest.TestCase):
    def test_counts_the_smaller_weight_of_each_shared_stock(self):
        pairs = fund_overlaps({"QQQM": fund(NVDA=8.0, MU=4.48, AMD=3.69, AAPL=8.16), "SMH": fund(NVDA=20.19, MU=4.75, AMD=5.35, TSM=9.58)})
        self.assertEqual(pairs[0]["funds"], ["QQQM", "SMH"])
        self.assertEqual(pairs[0]["minimum_overlap"], "16.2%")
        self.assertEqual(pairs[0]["shared_top_positions"], ["NVDA", "MU", "AMD"])

    def test_funds_sharing_nothing_are_left_out(self):
        self.assertEqual(fund_overlaps({"A": fund(X=5), "B": fund(Y=5)}), [])

    def test_biggest_overlap_comes_first(self):
        pairs = fund_overlaps({"A": fund(X=5, Y=5), "B": fund(X=5, Y=5), "C": fund(X=1)})
        self.assertEqual(pairs[0]["funds"], ["A", "B"])

    def test_stock_held_directly_and_through_funds(self):
        found = stocks_inside_funds({"AAPL", "TSLA"}, {"QQQM": fund(AAPL=8.16, NVDA=8.0), "VOO": fund(AAPL=7.38)})
        self.assertEqual(found, {"AAPL": ["QQQM 8.2%", "VOO 7.4%"]})


class YahooFundHoldings(unittest.TestCase):
    def test_parses_and_skips_rows_without_a_weight(self):
        rows = _parse_fund_holdings({"topHoldings": {"holdings": [
            {"symbol": "nvda", "holdingName": "NVIDIA", "holdingPercent": {"raw": 0.2019, "fmt": "20.19%"}},
            {"symbol": "X", "holdingPercent": {}},
        ]}})
        self.assertEqual([(r.symbol, r.weight) for r in rows], [("NVDA", 20.19)])

    def test_a_stock_has_none(self):
        self.assertEqual(_parse_fund_holdings({}), [])


CONTEXT = {"lang": "en", "tickers": {"TSLA", "SMH", "QQQM", "NVDA"}, "owned": {"TSLA", "SMH", "QQQM"}}


def advice(action="remove", ticker="TSLA", related="", reason="Weak"):
    return {"action": action, "ticker": ticker, "related_ticker": related, "reason": reason}


class AdviceRules(unittest.TestCase):
    def check(self, **kw):
        return PortfolioAdvice.model_validate(advice(**kw), context=CONTEXT)

    def test_valid(self):
        self.assertEqual(self.check(ticker="smh", related="qqqm").related_ticker, "QQQM")

    def test_no_invented_tickers(self):
        with self.assertRaises(ValidationError):
            self.check(ticker="ZZZ")
        with self.assertRaises(ValidationError):
            self.check(ticker="SMH", related="ZZZ")

    def test_cannot_remove_what_isnt_held(self):
        with self.assertRaises(ValidationError):
            self.check(ticker="NVDA")
        self.assertEqual(self.check(action="add", ticker="NVDA").action, "add")

    def test_needs_a_ticker_and_a_reason(self):
        with self.assertRaises(ValidationError):
            self.check(ticker="")
        with self.assertRaises(ValidationError):
            self.check(reason="  ")

    def test_data_field_names_are_sent_back(self):
        with self.assertRaises(ValidationError):
            self.check(reason="Weak: earnings_growth_yoy is -43.6%")
        with self.assertRaises(ValidationError):
            PortfolioQuestion.model_validate({"question": "Why?", "answer": "See fund_overlap"}, context=CONTEXT)

    def test_ukrainian_reason_required_when_asked(self):
        with self.assertRaises(ValidationError):
            PortfolioAdvice.model_validate(advice(reason="Weak business"), context={**CONTEXT, "lang": "uk"})
        with self.assertRaises(ValidationError):
            PortfolioQuestion.model_validate({"question": "Why?", "answer": "Because"}, context={"lang": "uk"})


def analysis_data(**extra):
    return {
        "health": "good",
        "confidence": "high",
        "headline": "h",
        "summary": "s",
        "diversification": "d",
        "performance": "p",
        "valuation_risk": "v",
        "strengths": ["a"],
        "risks": ["b"],
        "actions": [{"action": "hold", "ticker": "", "detail": "x"}],
        "cash_plan": "c",
        **extra,
    }


class Questions(unittest.TestCase):
    def test_a_fresh_answer_must_have_questions_but_may_have_no_advice(self):
        with self.assertRaises(ValidationError):
            PortfolioAnalysis.model_validate(analysis_data(advice=[], questions=[]), context=CONTEXT)
        q = [{"question": "Why?", "answer": "Because"}]
        self.assertEqual(PortfolioAnalysis.model_validate(analysis_data(advice=[], questions=q), context=CONTEXT).advice, [])

    def test_a_review_saved_before_these_existed_still_loads(self):
        row = ({"analysis": analysis_data(), "model": "m", "lang": "en", "account_value": 1.0}, datetime(2026, 11, 1, tzinfo=timezone.utc))
        conn = SimpleNamespace(execute=lambda sql, params=None: SimpleNamespace(fetchone=lambda: row))
        res = get_portfolio_analysis(SimpleNamespace(id=1), conn)
        self.assertEqual(res.analysis.headline, "h")
        self.assertEqual((res.analysis.advice, res.analysis.questions), ([], []))


if __name__ == "__main__":
    unittest.main()
