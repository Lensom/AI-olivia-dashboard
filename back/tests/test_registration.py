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


class Registration(unittest.TestCase):
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
