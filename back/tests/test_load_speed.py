"""Things that made pages hang: exchange rates looked up again on every load, and several requests building the same
book series at once. Run: python -m unittest discover -s tests"""

import threading
import time
import unittest
from unittest import mock
from urllib.error import HTTPError

from app.investing import router as investing
from app.library import series


class FxRates(unittest.TestCase):
    def setUp(self):
        investing._fx_cache.clear()
        self.urls = []

    def answer(self, rate):
        def fake(req, timeout=None):
            self.urls.append(req.full_url)
            if rate is None:
                raise HTTPError(req.full_url, 404, "not found", {}, None)
            body = mock.MagicMock()
            body.__enter__.return_value.read.return_value = f'{{"rates": {{"USD": {rate}}}}}'.encode()
            return body

        return fake

    def test_a_rate_the_source_lacks_is_not_asked_again_on_the_next_load(self):
        with mock.patch.object(investing, "urlopen", self.answer(None)):
            self.assertIsNone(investing._fetch_fx_rate_to_usd("RUB", "24.03.2022"))
            asked = len(self.urls)
            self.assertIsNone(investing._fetch_fx_rate_to_usd("RUB", "24.03.2022"))
        self.assertEqual(len(self.urls), asked)

    def test_a_failure_is_tried_again_after_a_while(self):
        with mock.patch.object(investing, "urlopen", self.answer(None)):
            investing._fetch_fx_rate_to_usd("RUB", "24.03.2022")
        later = time.time() + investing._FX_TTL + 1
        with mock.patch.object(investing, "urlopen", self.answer(0.0095)), mock.patch.object(investing.time, "time", return_value=later):
            self.assertEqual(investing._fetch_fx_rate_to_usd("RUB", "24.03.2022"), 0.0095)

    def test_a_past_days_rate_is_kept_for_long(self):
        with mock.patch.object(investing, "urlopen", self.answer(1.0849)):
            investing._fetch_fx_rate_to_usd("EUR", "05.03.2024")
        later = time.time() + 7 * 24 * 60 * 60
        with mock.patch.object(investing, "urlopen", self.answer(None)), mock.patch.object(investing.time, "time", return_value=later):
            self.assertEqual(investing._fetch_fx_rate_to_usd("EUR", "05.03.2024"), 1.0849)
        self.assertEqual(len(self.urls), 1)

    def test_asks_the_current_host_directly(self):
        with mock.patch.object(investing, "urlopen", self.answer(1.08)):
            investing._fetch_fx_rate_to_usd("EUR", "05.03.2024")
        self.assertTrue(self.urls[0].startswith("https://api.frankfurter.dev/v1/2024-03-05?"))

    def test_dollars_need_no_lookup(self):
        with mock.patch.object(investing, "urlopen", self.answer(None)):
            self.assertEqual(investing._fetch_fx_rate_to_usd("USD", "24.03.2022"), 1.0)
        self.assertEqual(self.urls, [])


class SeriesBuiltOnce(unittest.TestCase):
    def setUp(self):
        series._series_cache.clear()
        series._series_locks.clear()

    def test_requests_asking_together_share_one_build(self):
        builds = []

        def slow_build(series_id, lang):
            builds.append(series_id)
            time.sleep(0.2)
            series._series_cache[(series_id, lang)] = (time.time(), None)
            return None

        with mock.patch.object(series, "_build_series", slow_build):
            threads = [threading.Thread(target=series._series, args=("Q8337", "uk")) for _ in range(4)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(builds, ["Q8337"])

    def test_different_series_build_independently(self):
        builds = []

        def build(series_id, lang):
            builds.append(series_id)
            series._series_cache[(series_id, lang)] = (time.time(), None)

        with mock.patch.object(series, "_build_series", build):
            series._series("Q1", "uk")
            series._series("Q2", "uk")
            series._series("Q1", "en")
        self.assertEqual(builds, ["Q1", "Q2", "Q1"])


if __name__ == "__main__":
    unittest.main()
