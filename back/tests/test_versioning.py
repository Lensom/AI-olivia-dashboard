"""A save from a tab that loaded an older version is refused instead of erasing a newer one.
Run: python -m unittest discover -s tests"""

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException

from app.versioning import CONFLICT_DETAIL, check_base_version

SAVED = datetime(2026, 11, 25, 10, 0, 0, 123456, tzinfo=timezone.utc)


class Conn:
    """Answers the version lookup with the row's updated_at (None: nothing saved yet)."""

    def __init__(self, updated_at):
        self.updated_at = updated_at
        self.sql = []

    def execute(self, query, params=None):
        self.sql.append(query.as_string(None) if hasattr(query, "as_string") else query)
        return SimpleNamespace(fetchone=lambda: None if self.updated_at is None else (self.updated_at,))


class BaseVersion(unittest.TestCase):
    def refused(self, conn, base):
        with self.assertRaises(HTTPException) as caught:
            check_base_version(conn, "task_boards", 1, base)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["code"], "version_conflict")

    def test_the_version_this_tab_saw_saves(self):
        check_base_version(Conn(SAVED), "task_boards", 1, str(SAVED))

    def test_the_same_moment_written_in_another_zone_saves(self):
        check_base_version(Conn(SAVED), "task_boards", 1, SAVED.astimezone(timezone(timedelta(hours=2))).isoformat())

    def test_a_newer_save_elsewhere_is_not_overwritten(self):
        self.refused(Conn(SAVED + timedelta(seconds=5)), str(SAVED))

    def test_a_tab_that_saw_nothing_does_not_overwrite_a_first_save_elsewhere(self):
        self.refused(Conn(SAVED), "none")

    def test_a_tab_that_saw_nothing_saves_the_first_version(self):
        check_base_version(Conn(None), "task_boards", 1, "none")

    def test_no_header_saves_as_before_without_a_lookup(self):
        conn = Conn(SAVED + timedelta(days=1))
        check_base_version(conn, "task_boards", 1, None)
        self.assertEqual(conn.sql, [])

    def test_a_value_the_server_never_gave_out_does_not_block_the_save(self):
        check_base_version(Conn(SAVED), "task_boards", 1, "yesterday")

    def test_the_row_is_locked_until_the_save_commits(self):
        conn = Conn(SAVED)
        check_base_version(conn, "task_boards", 1, str(SAVED))
        self.assertIn("FOR UPDATE", conn.sql[0])
        self.assertIn('"task_boards"', conn.sql[0])

    def test_the_message_says_what_to_do(self):
        self.assertIn("Reload", CONFLICT_DETAIL["message"])


if __name__ == "__main__":
    unittest.main()
