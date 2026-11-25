"""Jobs: what's new since you looked, what's interesting, and the daily run. Run: python -m unittest discover -s tests"""

import asyncio
from contextlib import nullcontext
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.jobs import router as jobs
from app.jobs.router import JobView, daily_run, interesting

NOW = datetime(2026, 11, 23, 9, tzinfo=timezone.utc)


def view(**kw):
    base = dict(id="a" * 20, source="x", title="Frontend Engineer", company="Acme", location="", country="NL", url="https://x.example",
                first_seen=NOW.isoformat(), assessed=True, match=80, language="english_ok", relocation="not_mentioned")
    return JobView(**{**base, **kw})


class Interesting(unittest.TestCase):
    def test_a_good_match_you_could_take(self):
        self.assertTrue(interesting(view()))

    def test_not_when_any_condition_fails(self):
        for kw in ({"match": 74}, {"match": None}, {"language": "local_required"}, {"relocation": "not_offered"}, {"role": "fullstack"}, {"status": "hidden"}, {"status": "rejected"}):
            self.assertFalse(interesting(view(**kw)), kw)


class NewSinceYouLooked(unittest.TestCase):
    def state(self, seen):
        rows = [
            ("a" * 20, {"title": "Frontend Engineer", "assessment": {"match": 90, "language": "english_ok", "relocation": "offered"}}, "new", NOW, NOW, NOW),
            ("b" * 20, {"title": "Frontend Engineer", "assessment": {"match": 90, "language": "english_ok", "relocation": "offered"}}, "new", NOW - timedelta(days=3), NOW, NOW),
        ]
        profile = (None, None, None, NOW, [], seen, "uk")

        def execute(sql, params=None):
            if "FROM job_search_profiles" in sql:
                return SimpleNamespace(fetchone=lambda: profile)
            return SimpleNamespace(fetchall=lambda: rows)

        return jobs._state(SimpleNamespace(execute=execute), 1)

    def test_found_after_your_last_look_is_new(self):
        s = self.state(NOW - timedelta(days=1))
        self.assertEqual([j.new for j in s.jobs], [True, False])
        self.assertEqual(s.new_interesting, 1)

    def test_on_a_first_visit_nothing_is_new(self):
        s = self.state(None)
        self.assertEqual((s.new_interesting, [j.new for j in s.jobs]), (0, [False, False]))


class DailyRun(unittest.TestCase):
    def call(self, secret, header, **patches):
        conn = SimpleNamespace(execute=lambda sql, params=None: SimpleNamespace(fetchall=lambda: [(1, "uk"), (2, "en")]))
        return asyncio.run(daily_run(lambda: nullcontext(conn), object(), secret, header))

    def test_off_without_a_secret(self):
        with self.assertRaises(HTTPException) as caught:
            self.call("", "Bearer anything")
        self.assertEqual(caught.exception.status_code, 503)

    def test_refuses_a_wrong_or_missing_token(self):
        for header in (None, "Bearer wrong", "s3cret"):
            with self.assertRaises(HTTPException) as caught:
                self.call("s3cret", header)
            self.assertEqual(caught.exception.status_code, 401, header)

    def test_collects_once_for_everyone_and_assesses_until_done(self):
        calls = {"fetch": 0, "saved": [], "assessed": []}

        def fetch_all():
            calls["fetch"] += 1
            return ["job"], [SimpleNamespace(ok=True)]

        batches = {1: [5, 2, 0], 2: [0]}

        async def assess(conn, user_id, llm, lang, fullstack):
            calls["assessed"].append((user_id, lang, fullstack))
            return batches[user_id].pop(0)

        with patch.object(jobs, "fetch_all", fetch_all), patch.object(jobs, "fetch_registers", lambda: ({}, [])), \
             patch.object(jobs, "save_found", lambda conn, uid, found, statuses: calls["saved"].append(uid)), \
             patch.object(jobs, "apply_sponsors", lambda conn, uid, regs: None), patch.object(jobs, "_assess_next", assess):
            result = self.call("s3cret", "Bearer s3cret")
        self.assertEqual(calls["fetch"], 1)
        self.assertEqual(calls["saved"], [1, 2])
        self.assertEqual(result["assessed"], 7)
        self.assertTrue(all(lang in ("uk", "en") and not fullstack for _, lang, fullstack in calls["assessed"]))

    def test_a_spent_quota_stops_assessing_without_failing(self):
        async def assess(*a):
            raise HTTPException(status_code=429, detail="quota")

        with patch.object(jobs, "fetch_all", lambda: (["job"], [SimpleNamespace(ok=True)])), patch.object(jobs, "fetch_registers", lambda: ({}, [])), \
             patch.object(jobs, "save_found", lambda *a: None), patch.object(jobs, "apply_sponsors", lambda *a: None), patch.object(jobs, "_assess_next", assess):
            self.assertEqual(self.call("s3cret", "Bearer s3cret")["assessed"], 0)


if __name__ == "__main__":
    unittest.main()
