"""Life → Career: the job-search document, its parts saved separately, applications and the sponsor check.
Run: python -m unittest discover -s tests"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from app.career import router as career
from app.career.router import Application, CareerData, add_application, check_sponsors, get_career, save_career, week_of


class Conn:
    def __init__(self):
        self.row = None

    def execute(self, sql, params=None):
        if sql.lstrip().startswith("INSERT"):
            self.row = (params[1].obj, "2026-11-22")
            return SimpleNamespace(fetchone=lambda: ("2026-11-22",))
        return SimpleNamespace(fetchone=lambda: self.row)

    def commit(self):
        pass


USER = SimpleNamespace(id=1)


def application(i="a1", **kw):
    return Application(id=i, company="Mollie", applied="2026-11-24", **kw)


class Document(unittest.TestCase):
    def test_nothing_saved_is_an_empty_document(self):
        doc = get_career(USER, Conn())
        self.assertEqual((doc.progress, doc.checks, doc.weeks, doc.applications), ({}, {}, {}, []))

    def test_each_page_saves_only_its_part(self):
        conn = Conn()
        save_career(CareerData(progress={"l-tok": 2}), USER, conn)
        save_career(CareerData(checks={"w1-linkedin": True}), USER, conn)  # the plan page doesn't know the roadmap
        save_career(CareerData(applications=[application()]), USER, conn)
        doc = get_career(USER, conn)
        self.assertEqual(doc.progress, {"l-tok": 2})
        self.assertEqual(doc.checks, {"w1-linkedin": True})
        self.assertEqual([a.company for a in doc.applications], ["Mollie"])

    def test_bad_values_are_refused(self):
        for bad in (
            {"progress": {"l-tok": 3}},
            {"progress": {"<script>": 1}},
            {"checks": {"w1": False}},
            {"weeks": {"last week": {}}},
            {"weeks": {"2026-11-23": {"messages": -1}}},
            {"applications": [{"id": "a", "company": "X", "applied": "2026-11-24", "url": "javascript:alert(1)"}]},
            {"applications": [{"id": "a", "company": "X", "applied": "2026-11-24", "stage": "hired"}]},
        ):
            with self.assertRaises(ValidationError, msg=bad):
                CareerData(**bad)


class Applications(unittest.TestCase):
    def test_from_the_jobs_page_the_same_vacancy_is_added_once(self):
        conn = Conn()
        add_application(application("a1", job_id="j" * 20), USER, conn)
        add_application(application("a2", job_id="j" * 20), USER, conn)
        add_application(application("a3", url="https://x.example/1"), USER, conn)
        add_application(application("a4", url="https://x.example/1"), USER, conn)
        self.assertEqual([a.id for a in get_career(USER, conn).applications], ["a3", "a1"])

    def test_adding_keeps_the_rest_of_the_document(self):
        conn = Conn()
        save_career(CareerData(progress={"l-tok": 1}), USER, conn)
        add_application(application(), USER, conn)
        self.assertEqual(get_career(USER, conn).progress, {"l-tok": 1})


class Sponsors(unittest.TestCase):
    def setUp(self):
        career._registers = None

    def test_listed_companies_are_named(self):
        regs = {"NL": {"mollie": "Mollie B.V."}, "DK": {"pleo": "Pleo Technologies ApS"}}
        with patch.object(career, "fetch_registers", return_value=(regs, [])):
            result = {r.company: r for r in check_sponsors(["Mollie", "Pleo", "Nobody", "Mollie"], USER)}
        self.assertEqual(result["Mollie"].ind, "Mollie B.V.")
        self.assertEqual(result["Pleo"].siri, "Pleo Technologies ApS")
        self.assertEqual((result["Nobody"].ind, result["Nobody"].siri), ("", ""))
        self.assertEqual(len(result), 3)

    def test_registers_are_downloaded_once_a_day_and_a_failure_keeps_the_last_copy(self):
        regs = {"NL": {"mollie": "Mollie B.V."}}
        with patch.object(career, "fetch_registers", return_value=(regs, [])) as fetch:
            check_sponsors(["Mollie"], USER)
            check_sponsors(["Mollie"], USER)
        self.assertEqual(fetch.call_count, 1)
        career._registers = (0.0, regs)  # long ago
        with patch.object(career, "fetch_registers", return_value=({}, [])):
            self.assertEqual(check_sponsors(["Mollie"], USER)[0].ind, "Mollie B.V.")


class Weeks(unittest.TestCase):
    def test_a_day_belongs_to_its_monday(self):
        self.assertEqual(week_of("2026-11-29"), "2026-11-23")  # Sunday
        self.assertEqual(week_of("2026-11-23"), "2026-11-23")
        self.assertEqual(week_of("2027-01-01"), "2026-12-28")


if __name__ == "__main__":
    unittest.main()
