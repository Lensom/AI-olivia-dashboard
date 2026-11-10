"""Registration stays closed unless explicitly turned on. Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.auth.router import register
from app.auth.schemas import RegisterRequest
from app.main import Settings


class RecordingConn:
    def __init__(self):
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append(sql)
        return SimpleNamespace(fetchone=lambda: (1,))

    def commit(self):
        pass


PAYLOAD = RegisterRequest(email="new@example.com", password="long-enough-password")


class FailingConn(RecordingConn):
    def __init__(self, error):
        super().__init__()
        self.error = error
        self.rolled_back = False

    def execute(self, sql, params=None):
        raise self.error

    def rollback(self):
        self.rolled_back = True


class Registration(unittest.TestCase):
    def test_a_taken_email_is_409_and_the_transaction_is_rolled_back(self):
        from psycopg import errors

        conn = FailingConn(errors.UniqueViolation("duplicate key"))
        with self.assertRaises(HTTPException) as caught:
            register(PAYLOAD, conn, SimpleNamespace(allow_registration=True))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertTrue(conn.rolled_back)

    def test_another_database_error_is_not_reported_as_a_taken_email(self):
        conn = FailingConn(RuntimeError("database is down"))
        with self.assertRaises(RuntimeError):
            register(PAYLOAD, conn, SimpleNamespace(allow_registration=True))
        self.assertTrue(conn.rolled_back)

    def test_closed_by_default(self):
        self.assertFalse(Settings.model_fields["allow_registration"].default)

    def test_closed_refuses_and_writes_nothing(self):
        conn = RecordingConn()
        with self.assertRaises(HTTPException) as caught:
            register(PAYLOAD, conn, SimpleNamespace(allow_registration=False))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(conn.executed, [])

    def test_can_be_turned_on(self):
        conn = RecordingConn()
        created = register(PAYLOAD, conn, SimpleNamespace(allow_registration=True))
        self.assertEqual(created.email, "new@example.com")
        self.assertTrue(conn.executed)


if __name__ == "__main__":
    unittest.main()
