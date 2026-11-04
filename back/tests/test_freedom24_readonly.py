"""Guards that the Freedom24 client can only read. Run: python -m unittest discover -s tests"""

import unittest
from unittest import mock

from app.broker import freedom24
from app.broker.freedom24 import READ_ONLY_COMMANDS, TRADING_COMMANDS, Freedom24ReadOnly, TradingForbidden


class ReadOnlyGuard(unittest.TestCase):
    def test_allowlist_has_no_trading_commands(self):
        self.assertFalse(READ_ONLY_COMMANDS & TRADING_COMMANDS)

    def test_allowlist_is_reads_only(self):
        # Every Tradernet read starts with "get"; writes are put*/del*/send*/add*.
        for cmd in READ_ONLY_COMMANDS:
            self.assertTrue(cmd.startswith("get"), cmd)

    def test_trading_is_refused_before_any_request(self):
        client = Freedom24ReadOnly("public", "private")
        with mock.patch.object(freedom24, "urlopen", side_effect=AssertionError("must not reach the network")):
            for cmd in [*TRADING_COMMANDS, "anythingElse", "getSomethingNotListed"]:
                with self.assertRaises(TradingForbidden, msg=cmd):
                    client._call(cmd, {"ticker": "AAPL.US", "quantity": 1})

    def test_no_trading_helpers_exist(self):
        public = {name for name in dir(Freedom24ReadOnly) if not name.startswith("_")}
        self.assertEqual(public, {"portfolio", "trades", "broker_report", "corporate_actions", "quotes", "candles"})


if __name__ == "__main__":
    unittest.main()
