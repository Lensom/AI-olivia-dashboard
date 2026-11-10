"""The investing chat: the account reaches the model, and the conversation is sent the way Gemini needs it.
Run: python -m unittest discover -s tests"""

import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from pydantic import ValidationError

from app.investing import chat as chat_module
from app.investing.chat import ChatRequest, build_context, chat, system_instruction
from app.llm.client import StructuredResult

USER = SimpleNamespace(id=7, email="me@example.com")
ACCOUNT = {"account": {"cash": "$844.98"}, "positions": [{"ticker": "TSLA"}], "broker_data_unavailable": None}


class FakeLLM:
    def __init__(self):
        self.calls = []
        self.usage = SimpleNamespace(summary=lambda: "")

    async def chat(self, messages, system_instruction, tools=None):
        self.calls.append((messages, system_instruction))
        return StructuredResult(value="Reply", model="m")


def turns(*contents):
    return [{"role": "user" if i % 2 == 0 else "assistant", "content": c} for i, c in enumerate(contents)]


class Base(unittest.TestCase):
    def setUp(self):
        chat_module._account_cache.clear()
        self.gather = mock.Mock(return_value=(dict(ACCOUNT), 1000.0, {"TSLA"}))
        for name, value in (
            ("_gather_portfolio", self.gather),
            ("_portfolio_insights", lambda positions: {"fund_overlap": None}),
            ("_load", lambda conn, user_id, key: None),
        ):
            patcher = mock.patch.object(chat_module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_chat(self, payload, llm=None, gather=None):
        return asyncio.run(chat(ChatRequest(**payload), USER, None, llm, lambda user: None))


class Context(Base):
    def test_the_account_goes_into_the_system_instruction(self):
        llm = FakeLLM()
        res = self.run_chat({"messages": turns("How much cash do I have?")}, llm)
        self.assertEqual(res.reply, "Reply")
        messages, system = llm.calls[0]
        self.assertIn("$844.98", system)
        self.assertIn("TSLA", system)
        self.assertEqual([m.content for m in messages], ["How much cash do I have?"])

    def test_a_conversation_reuses_the_account_for_a_while(self):
        for _ in range(3):
            build_context(None, USER, None, lambda user: None)
        self.assertEqual(self.gather.call_count, 1)

    def test_accounts_never_share_a_context(self):
        build_context(None, USER, None, lambda user: None)
        build_context(None, SimpleNamespace(id=8, email="x@example.com"), None, lambda user: None)
        self.assertEqual(self.gather.call_count, 2)

    def test_a_broker_outage_is_flagged_and_not_remembered(self):
        self.gather.return_value = ({**ACCOUNT, "broker_data_unavailable": True}, 1000.0, set())
        res = self.run_chat({"messages": turns("Hi")}, FakeLLM())
        self.assertTrue(res.stale_data)
        build_context(None, USER, None, lambda user: None)
        self.assertEqual(self.gather.call_count, 2)

    def test_no_holdings_still_answers(self):
        self.gather.side_effect = HTTPException(status_code=404, detail="No holdings")
        llm = FakeLLM()
        self.run_chat({"messages": turns("Hi")}, llm)
        self.assertIn("no holdings", llm.calls[0][1])

    def test_the_open_stock_is_added_and_a_failure_there_is_survivable(self):
        with mock.patch.object(chat_module, "fetch_detail", return_value=None):
            context = build_context(None, USER, "aapl", lambda user: None)
        self.assertIsNone(context["stock_open_on_screen"])
        self.assertIn("stock_open_on_screen", system_instruction(context))


class Conversation(Base):
    def test_only_recent_messages_are_sent_and_the_first_is_the_users(self):
        llm = FakeLLM()
        self.run_chat({"messages": turns(*[f"m{i}" for i in range(31)])}, llm)
        sent = llm.calls[0][0]
        self.assertLessEqual(len(sent), 20)
        self.assertEqual(sent[0].role, "user")
        self.assertEqual(sent[-1].content, "m30")

    def test_must_end_with_a_user_message(self):
        with self.assertRaises(ValidationError):
            ChatRequest(messages=turns("Hi", "Hello"))

    def test_rejects_blank_too_long_and_odd_tickers(self):
        with self.assertRaises(ValidationError):
            ChatRequest(messages=turns("   "))
        with self.assertRaises(ValidationError):
            ChatRequest(messages=turns("x" * 4001))
        with self.assertRaises(ValidationError):
            ChatRequest(messages=turns("Hi"), ticker="../etc")

    def test_without_a_key_it_says_so(self):
        with self.assertRaises(HTTPException) as caught:
            self.run_chat({"messages": turns("Hi")}, None)
        self.assertEqual(caught.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
