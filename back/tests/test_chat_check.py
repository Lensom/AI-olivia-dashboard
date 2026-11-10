"""The chat's answer check, the tool loop in the Gemini client, and how the chat uses both.
Run: python -m unittest discover -s tests"""

import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

from google.genai import types

from app.investing import chat as chat_module
from app.investing.chat import ChatRequest, chat
from app.investing.chat_check import check, repair_message
from app.llm.client import LLMClient, TextResult, Tool

DATA = '{"cash": "$844.98", "cash_share": "12.4%", "net_debt": "$1.2B", "positions": [{"ticker": "TSLA", "weight": "+10.6%"}], "day": "-2.35%"}'


class Figures(unittest.TestCase):
    def test_figures_from_the_data_pass_as_written_or_rounded(self):
        for answer in ("Cash is $844.98.", "About $845 in cash.", "Cash share 12.4%, roughly 12%.", "Net debt $1.2B.", "TSLA is 10.6% of it.", "Down 2.35% today"):
            self.assertFalse(check(answer, DATA), answer)

    def test_ukrainian_formats_pass(self):
        for answer in ("Кеш: 844,98 $", "Частка кешу 12,4%", "Чистий борг 1,2 млрд $", "Сьогодні -2,35%"):
            self.assertFalse(check(answer, DATA), answer)

    def test_a_figure_not_in_the_data_is_caught(self):
        self.assertEqual(check("You have $350.13 in cash and 15.2% of it is idle.", DATA).figures, ["$350.13", "15.2%"])

    def test_rounding_only_within_what_is_shown(self):
        self.assertTrue(check("Cash is $844.90.", DATA))  # two decimals shown: must match to the cent
        self.assertTrue(check("Cash is $850.", DATA))  # $844.98 doesn't round to $850

    def test_thousands_and_scale_words(self):
        data = '{"value": "$12,345.00", "revenue": "$2.5B"}'
        for answer in ("Worth $12,345", "Worth $12.3k", "Worth 12 345 $", "Revenue $2.5 billion is $2.5B", "Виручка 2,5 млрд $"):
            self.assertFalse(check(answer, data), answer)

    def test_a_note_saying_100k_covers_100000_dollars(self):
        data = '{"notes": "Increase ETF allocations - after 100k in portfolio"}'
        for answer in ("After the portfolio reaches $100,000", "Після $100k", "після 100 000 $", "після 100к $"):
            self.assertFalse(check(answer, data), answer)
        self.assertTrue(check("After $200,000", data))

    def test_zero_and_a_hundred_percent_are_not_checked(self):
        self.assertFalse(check("0% in bonds, 100% in stocks", DATA))


class Tickers(unittest.TestCase):
    def test_a_ticker_with_a_figure_but_no_data_is_caught(self):
        self.assertEqual(check("NVDA trades at $135.20.", DATA).tickers, ["NVDA"])

    def test_a_ticker_mentioned_without_figures_is_fine(self):
        self.assertFalse(check("You could look at VOO instead of picking single stocks.", DATA))

    def test_words_in_capitals_are_not_tickers(self):
        self.assertFalse(check("The ETF's EPS and the USD: 12.4% of the account.", DATA).tickers)

    def test_tickers_in_the_data_are_fine(self):
        self.assertFalse(check("TSLA is 10.6% of the account.", DATA))

    def test_the_message_names_what_failed_and_never_reaches_the_investor(self):
        msg = repair_message(check("NVDA at $135.20, cash $350.13", DATA))
        self.assertIn("$350.13", msg)
        self.assertIn("NVDA", msg)
        self.assertIn("get_stock", msg)


def response(*parts):
    return types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(role="model", parts=list(parts)))])


def call(name="get_stock", **args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


def text(t):
    return types.Part(text=t)


class ToolLoop(unittest.TestCase):
    def client(self, *responses):
        llm = LLMClient(api_key="test", models=["m1"])
        self.sent = []

        async def fake(model, contents, config=None):
            self.sent.append((list(contents), config))
            return responses[len(self.sent) - 1]

        llm._generate_content = fake
        return llm

    def tool(self, result=None, fail=False):
        self.runs = []

        async def run(args):
            self.runs.append(args)
            if fail:
                raise RuntimeError("source down")
            return result or {"price": "$135.20"}

        return Tool(name="get_stock", description="d", parameters={"type": "object", "properties": {"ticker": {"type": "string"}}}, run=run)

    def chat(self, llm, tools):
        from app.llm.client import ChatMessage

        return asyncio.run(llm.chat([ChatMessage(role="user", content="NVDA?")], "system", tools=tools))

    def test_runs_the_tool_and_answers_with_its_result(self):
        llm = self.client(response(call(ticker="NVDA")), response(text("NVDA is $135.20.")))
        result = self.chat(llm, [self.tool()])
        self.assertEqual(result.value, "NVDA is $135.20.")
        self.assertEqual(self.runs, [{"ticker": "NVDA"}])
        answer = self.sent[1][0][-1].parts[0].function_response
        self.assertEqual((answer.name, answer.response), ("get_stock", {"price": "$135.20"}))

    def test_a_model_that_keeps_calling_must_answer_after_three_rounds(self):
        llm = self.client(*[response(call(ticker=f"T{i}")) for i in range(3)], response(text("Done.")))
        self.assertEqual(self.chat(llm, [self.tool()]).value, "Done.")
        self.assertEqual(len(self.runs), 3)
        self.assertEqual(self.sent[-1][1].tool_config.function_calling_config.mode, "NONE")

    def test_a_failing_tool_or_unknown_one_gets_an_error_not_a_crash(self):
        llm = self.client(response(call(ticker="NVDA"), call(name="delete_everything")), response(text("Couldn't load it.")))
        self.assertEqual(self.chat(llm, [self.tool(fail=True)]).value, "Couldn't load it.")
        answers = [p.function_response.response for p in self.sent[1][0][-1].parts]
        self.assertIn("error", answers[0])
        self.assertIn("no tool", answers[1]["error"])

    def test_too_many_calls_at_once_are_refused_past_the_limit(self):
        llm = self.client(response(*[call(ticker=f"T{i}") for i in range(6)]), response(text("ok")))
        self.chat(llm, [self.tool()])
        self.assertEqual(len(self.runs), 4)

    def test_without_tools_nothing_is_declared(self):
        llm = self.client(response(text("Hi.")))
        self.assertEqual(self.chat(llm, None).value, "Hi.")
        self.assertIsNone(self.sent[0][1].tools)


USER = SimpleNamespace(id=7, email="me@example.com")
ACCOUNT = {"account": {"cash": "$844.98"}, "positions": [{"ticker": "TSLA"}], "broker_data_unavailable": None}


class ScriptedLLM:
    """Answers in turn; a callable answer gets the tools, like a model calling one."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []
        self.usage = SimpleNamespace(summary=lambda: "")

    async def chat(self, messages, system_instruction, tools=None):
        self.calls.append(messages)
        answer = self.answers.pop(0)
        if callable(answer):
            answer = await answer(tools)
        if isinstance(answer, Exception):
            raise answer
        return TextResult(value=answer, model="m")


class ChatUsesThem(unittest.TestCase):
    def setUp(self):
        chat_module._account_cache.clear()
        for name, value in (
            ("_gather_portfolio", mock.Mock(return_value=(dict(ACCOUNT), 1000.0, {"TSLA"}))),
            ("_portfolio_insights", lambda positions: {}),
            ("_load", lambda conn, user_id, key: None),
            ("_focus_facts", lambda conn, user, ticker, source_for: {"ticker": ticker, "price": "$135.20"} if ticker == "NVDA" else None),
        ):
            patcher = mock.patch.object(chat_module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_chat(self, llm, question="How much cash?"):
        return asyncio.run(chat(ChatRequest(messages=[{"role": "user", "content": question}]), USER, None, llm, lambda user: None))

    def test_a_correct_answer_costs_one_call(self):
        llm = ScriptedLLM("You have $844.98 in cash.")
        res = self.run_chat(llm)
        self.assertEqual((res.reply, res.corrected, len(llm.calls)), ("You have $844.98 in cash.", False, 1))

    def test_a_wrong_figure_gets_one_rewrite(self):
        llm = ScriptedLLM("You have $350.13 in cash.", "You have $844.98 in cash.")
        res = self.run_chat(llm)
        self.assertEqual((res.reply, res.corrected), ("You have $844.98 in cash.", True))
        self.assertIn("$350.13", llm.calls[1][-1].content)
        self.assertEqual(llm.calls[1][-2].content, "You have $350.13 in cash.")

    def test_only_one_rewrite_even_if_it_is_still_wrong(self):
        llm = ScriptedLLM("Cash $350.13", "Cash $351.00")
        res = self.run_chat(llm)
        self.assertEqual((res.reply, len(llm.calls)), ("Cash $351.00", 2))

    def test_a_failed_rewrite_shows_the_first_answer(self):
        llm = ScriptedLLM("Cash $350.13", RuntimeError("quota"))
        self.assertEqual(self.run_chat(llm).reply, "Cash $350.13")

    def test_figures_from_a_lookup_pass_the_check(self):
        async def looks_up(tools):
            found = await tools[0].run({"ticker": "nvda"})
            return f"NVDA trades at {found['price']}."

        llm = ScriptedLLM(looks_up)
        res = self.run_chat(llm, "What about NVDA?")
        self.assertEqual((res.reply, res.corrected, res.looked_up), ("NVDA trades at $135.20.", False, ["NVDA"]))

    def test_lookups_refuse_bad_tickers_and_are_limited(self):
        results = []

        async def many(tools):
            for t in ["bad ticker!", "NVDA", "NVDA", "ZZZZ", "A1", "B1", "C1", "D1"]:
                results.append(await tools[0].run({"ticker": t}))
            return "ok"

        self.run_chat(ScriptedLLM(many))
        self.assertIn("isn't a ticker", results[0]["error"])
        self.assertEqual(results[1], results[2])  # asked twice, fetched once
        self.assertIn("No market data", results[3]["error"])
        self.assertIn("At most", results[-1]["error"])


if __name__ == "__main__":
    unittest.main()
