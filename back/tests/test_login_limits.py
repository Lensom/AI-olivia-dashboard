"""Failed logins are limited per email and per address. Run: python -m unittest discover -s tests"""

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.auth import limits
from app.auth.router import login
from app.auth.schemas import LoginRequest
from app.auth.security import hash_password

PASSWORD_HASH = hash_password("right-password")


class Db:
    """Just enough of Postgres for the login: one user and the failure counts."""

    def __init__(self):
        self.failures = {}  # key -> [failures, window_start]

    def execute(self, sql, params=()):
        sql = " ".join(sql.split())
        if sql.startswith("SELECT key, failures, window_start"):
            rows = [(k, *self.failures[k]) for k in params[0] if k in self.failures]
            return SimpleNamespace(fetchall=lambda: rows)
        if sql.startswith("DELETE FROM login_failures WHERE window_start <"):
            self.failures = {k: v for k, v in self.failures.items() if v[1] >= params[0]}
        elif sql.startswith("INSERT INTO login_failures"):
            k, now = params
            self.failures.setdefault(k, [0, now])[0] += 1
        elif sql.startswith("DELETE FROM login_failures WHERE key ="):
            self.failures.pop(params[0], None)
        elif sql.startswith("SELECT id, email, password_hash FROM users"):
            row = (1, "me@example.com", PASSWORD_HASH) if params[0] == "me@example.com" else None
            return SimpleNamespace(fetchone=lambda: row)
        return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [])

    def commit(self):
        pass


SETTINGS = SimpleNamespace(auth_token_secret="test-secret", auth_token_ttl_seconds=60)


def request(ip="1.2.3.4", **headers):
    return SimpleNamespace(headers={k.replace("_", "-"): v for k, v in headers.items()}, client=SimpleNamespace(host=ip))


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)

    def __call__(self, tz=None):
        return self.now


class LoginLimits(unittest.TestCase):
    def setUp(self):
        self.db = Db()
        self.clock = Clock()
        patcher = patch("app.auth.router.dt.datetime", SimpleNamespace(now=self.clock))
        patcher.start()
        self.addCleanup(patcher.stop)

    def attempt(self, password="wrong", email="me@example.com", req=None):
        try:
            login(LoginRequest(email=email, password=password), req or request(), self.db, SETTINGS)
            return 200
        except HTTPException as e:
            return e.status_code

    def test_five_wrong_passwords_then_blocked_even_with_the_right_one(self):
        self.assertEqual([self.attempt() for _ in range(5)], [401] * 5)
        self.assertEqual(self.attempt("right-password"), 429)

    def test_blocked_answer_says_when_to_retry(self):
        for _ in range(5):
            self.attempt()
        self.clock.now += timedelta(minutes=5)
        with self.assertRaises(HTTPException) as caught:
            login(LoginRequest(email="me@example.com", password="x"), request(), self.db, SETTINGS)
        self.assertEqual(caught.exception.headers["Retry-After"], str(10 * 60))

    def test_open_again_after_the_window(self):
        for _ in range(5):
            self.attempt()
        self.clock.now += limits.WINDOW + timedelta(seconds=1)
        self.assertEqual(self.attempt("right-password"), 200)

    def test_success_clears_the_email_count(self):
        for _ in range(4):
            self.attempt()
        self.assertEqual(self.attempt("right-password"), 200)
        self.assertEqual([self.attempt() for _ in range(5)], [401] * 5)

    def test_changing_address_doesnt_get_round_the_email_limit(self):
        for i in range(5):
            self.attempt(req=request(ip=f"10.0.0.{i}"))
        self.assertEqual(self.attempt("right-password", req=request(ip="10.9.9.9")), 429)

    def test_one_address_trying_many_emails_is_blocked_too(self):
        for i in range(limits.LIMITS["ip"]):
            self.assertEqual(self.attempt(email=f"guess{i}@example.com"), 401)
        self.assertEqual(self.attempt("right-password"), 429)
        self.assertEqual(self.attempt("right-password", req=request(ip="5.6.7.8")), 200)

    def test_unknown_email_is_a_plain_401_and_counts(self):
        self.assertEqual(self.attempt(email="nobody@example.com"), 401)
        self.assertEqual(self.db.failures[limits.key("email", "nobody@example.com")][0], 1)

    def test_only_hashes_are_stored(self):
        self.attempt(req=request(ip="9.9.9.9"))
        stored = " ".join(self.db.failures)
        self.assertNotIn("me@example.com", stored)
        self.assertNotIn("9.9.9.9", stored)

    def test_email_case_and_spaces_dont_make_a_new_count(self):
        for email in ("me@example.com", "ME@example.com", "Me@Example.com", "me@example.com", "ME@EXAMPLE.COM"):
            self.attempt(email=email)
        self.assertEqual(self.attempt("right-password"), 429)


class Address(unittest.TestCase):
    def test_prefers_the_proxys_headers(self):
        self.assertEqual(limits.client_address(request(x_real_ip="7.7.7.7")), "7.7.7.7")
        self.assertEqual(limits.client_address(request(x_forwarded_for="8.8.8.8, 10.0.0.1")), "8.8.8.8")
        self.assertEqual(limits.client_address(request(ip="1.1.1.1")), "1.1.1.1")


if __name__ == "__main__":
    unittest.main()
