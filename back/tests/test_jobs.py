"""Life → Jobs: reading the sources, the CV, and keeping your statuses. Run: python -m unittest discover -s tests"""

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.jobs import sources as src
from app.jobs.router import JobAssessments, _view, apply_sponsors, extract_cv_text, save_found
from app.jobs.sources import RawJob, SourceResult
from app.jobs.sponsors import company_key, parse_register

VISA_CARD = """
<div class="job-card" data-position="{title}" data-company="acme" data-location="{location}" data-date="{date}">
  <h3 class="x"><a href="/visa-sponsored-jobs/acme-{slug}/" class="y">{title_text}</a></h3>
  <p class="z">Acme</p>
  <span class="badge badge-reloc">Relocation Assistance</span>
  <span class="badge badge-visa">Visa Sponsorship</span>
  <a href="{apply}" target="_blank" rel="noopener" class="job-card-apply">Apply</a>
</div>
"""


def card(title="senior frontend engineer", location="amsterdam, netherlands 🇳🇱", date="2099-01-01", apply="https://acme.example/jobs/1"):
    return VISA_CARD.format(title=title, location=location, date=date, slug=title.replace(" ", "-"), title_text=title.title(), apply=apply)


class Titles(unittest.TestCase):
    def test_frontend_roles(self):
        for title in ("Senior Frontend Engineer", "Front-End Developer", "Front End Engineer", "React Developer", "Web Developer", "UI Engineer"):
            self.assertTrue(src.is_frontend_title(title), title)

    def test_not_frontend_roles(self):
        for title in ("Backend Engineer", "Web Backend Developer", "Frontend Intern", "Product Designer, Web", "Engineering Manager, Frontend"):
            self.assertFalse(src.is_frontend_title(title), title)

    def test_countries(self):
        self.assertEqual(src.country_of("Amsterdam, Netherlands"), "NL")
        self.assertEqual(src.country_of("Oslo"), "NO")
        self.assertEqual(src.country_of("Copenhagen"), "DK")
        self.assertEqual(src.country_of("Berlin, Germany"), "")


class VisaJobs(unittest.TestCase):
    def test_reads_a_card(self):
        job = src.parse_visajobs(card())[0]
        self.assertEqual((job.title, job.company, job.country), ("Senior Frontend Engineer", "Acme", "NL"))
        self.assertTrue(job.relocation_stated and job.visa_stated)
        self.assertEqual(job.url, "https://acme.example/jobs/1")

    def test_other_countries_and_roles_are_left_out(self):
        self.assertEqual(src.parse_visajobs(card(location="tokyo, japan")), [])
        self.assertEqual(src.parse_visajobs(card(title="backend engineer")), [])

    def test_a_planted_link_is_not_shown(self):
        job = src.parse_visajobs(card(apply="javascript:alert(1)"))[0]
        self.assertTrue(job.url.startswith("https://visajobs.xyz/"))

    def test_only_relocate_links_are_fetched_later(self):
        self.assertEqual(src.parse_visajobs(card())[0].detail, {})
        job = src.parse_visajobs(card(apply="https://relocate.me/netherlands/amsterdam/acme/frontend-1"))[0]
        self.assertEqual(job.detail["kind"], "relocate")


class Age(unittest.TestCase):
    TODAY = datetime(2026, 11, 6, tzinfo=timezone.utc)

    def test_visajobs_writes_old_dates_in_words(self):
        self.assertEqual(src.parse_visajobs(card(date="January 4, 2025"))[0].posted, "2025-01-04")
        self.assertEqual(src.parse_visajobs(card(date="2026-08-12"))[0].posted, "2026-08-12")

    def test_old_postings_are_dropped_but_undated_stay(self):
        self.assertFalse(src.is_recent("2025-01-04", self.TODAY))
        self.assertTrue(src.is_recent("2026-10-01", self.TODAY))
        self.assertTrue(src.is_recent("", self.TODAY))


class Boards(unittest.TestCase):
    def test_greenhouse(self):
        jobs = src.parse_greenhouse("acme", {"jobs": [
            {"id": 1, "title": "Frontend Engineer", "location": {"name": "Amsterdam"}, "absolute_url": "https://x.example/1", "first_published": "2026-10-23T01:00:18-04:00"},
            {"id": 2, "title": "Frontend Engineer", "location": {"name": "Lisbon"}, "absolute_url": "https://x.example/2"},
            {"id": 3, "title": "Data Engineer", "location": {"name": "Oslo"}, "absolute_url": "https://x.example/3"},
        ]})
        self.assertEqual([j.external_id for j in jobs], ["acme:1"])
        self.assertEqual(jobs[0].posted, "2026-10-23")

    def test_ashby_looks_at_secondary_locations(self):
        jobs = src.parse_ashby("acme", {"jobs": [{
            "id": "a", "title": "Staff Front End Engineer", "location": "Lisbon",
            "secondaryLocations": [{"location": "Copenhagen"}], "jobUrl": "https://x.example/a", "descriptionPlain": "Text",
        }]})
        self.assertEqual((jobs[0].country, jobs[0].description), ("DK", "Text"))

    def test_lever(self):
        jobs = src.parse_lever("veo", [{"id": "a", "text": "React Developer", "categories": {"location": "Copenhagen"}, "hostedUrl": "https://x.example/a", "createdAt": 1790000000000}])
        self.assertEqual(jobs[0].country, "DK")
        self.assertRegex(jobs[0].posted, r"^\d{4}-\d{2}-\d{2}$")


    def test_recruitee(self):
        jobs = src.parse_recruitee("bunq", {"offers": [
            {"id": 1, "title": "Frontend Engineer", "city": "Amsterdam", "country": "Netherlands", "careers_url": "https://x.example/1", "published_at": "2026-10-01 10:00:00 UTC", "description": "<p>Build</p>", "requirements": "<p>React</p>"},
            {"id": 2, "title": "Frontend Engineer", "city": "Lisbon", "country": "Portugal", "careers_url": "https://x.example/2"},
        ]})
        self.assertEqual([j.external_id for j in jobs], ["bunq:1"])
        self.assertEqual(jobs[0].posted, "2026-10-01")
        self.assertIn("React", jobs[0].description)

    def test_smartrecruiters_uses_the_country_code(self):
        jobs = src.parse_smartrecruiters("coolblue", {"content": [
            {"id": "7", "name": "React Developer", "location": {"city": "Hengelo", "country": "nl"}, "company": {"name": "Coolblue"}, "releasedDate": "2026-10-01T00:00:00.000Z"},
            {"id": "8", "name": "React Developer", "location": {"city": "Antwerp", "country": "be"}},
        ]})
        self.assertEqual([(j.country, j.company) for j in jobs], [("NL", "Coolblue")])
        self.assertEqual(jobs[0].url, "https://jobs.smartrecruiters.com/coolblue/7")
        self.assertEqual(jobs[0].detail["kind"], "smartrecruiters")

    def test_workable(self):
        jobs = src.parse_workable("kahoot", {"name": "Kahoot!", "jobs": [{"title": "Frontend Developer", "shortcode": "ABC", "city": "Oslo", "country": "Norway", "url": "https://x.example/a", "published_on": "2026-10-01", "description": "<p>Text</p>"}]})
        self.assertEqual((jobs[0].company, jobs[0].country, jobs[0].description), ("Kahoot!", "NO", "Text"))


class Eures(unittest.TestCase):
    def ad(self, **kw):
        return {"id": "abc/1", "title": "Frontend Developer", "locationMap": {"NL": ["NL33"]}, "creationDate": 1793934934000, "description": "<p>Build things</p>", "employer": None, **kw}

    def test_reads_an_ad_without_an_employer(self):
        job = src.parse_eures({"jvs": [self.ad()]})[0]
        self.assertEqual((job.company, job.country, job.location, job.description), ("", "NL", "Netherlands", "Build things"))
        self.assertEqual(job.url, "https://europa.eu/eures/portal/jv-se/jv-details/abc%2F1?lang=en")
        self.assertRegex(job.posted, r"^\d{4}-\d{2}-\d{2}$")

    def test_leaves_out_other_roles_countries_and_recycled_ads(self):
        ads = [self.ad(title="Sales Manager"), self.ad(locationMap={"BE": []}), self.ad(title="Frontend Developer (Flash / HTML)"), self.ad(id="")]
        self.assertEqual(src.parse_eures({"jvs": ads}), [])

    def test_a_cut_off_entity_leaves_the_title(self):
        self.assertEqual(src.parse_eures({"jvs": [self.ad(title="Frontend Developer Career Opportunity &ndash")]})[0].title, "Frontend Developer Career Opportunity")

    def test_two_nameless_ads_with_one_title_stay_two_jobs(self):
        one, two = src.parse_eures({"jvs": [self.ad(id="1", description="First"), self.ad(id="2", description="Second")]})
        self.assertNotEqual(one.to_data()["dedupe_key"], two.to_data()["dedupe_key"])

    def test_the_same_nameless_ad_published_twice_is_one_job(self):
        one, two = src.parse_eures({"jvs": [self.ad(id="1"), self.ad(id="2")]})
        self.assertEqual(one.to_data()["dedupe_key"], two.to_data()["dedupe_key"])

    def test_waits_between_pages_and_stops_at_a_short_page(self):
        full = {"jvs": [self.ad(id=str(i), description=str(i)) for i in range(50)]}
        with patch.object(src, "_get_json", side_effect=[full, {"jvs": [self.ad(id="last")]}]) as get, patch.object(src.time, "sleep") as sleep:
            jobs = src.fetch_eures()
        self.assertEqual(len(jobs), 51)
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(10)

    def test_a_short_first_page_needs_no_second_request(self):
        with patch.object(src, "_get_json", return_value={"jvs": []}) as get, patch.object(src.time, "sleep") as sleep:
            self.assertEqual(src.fetch_eures(), [])
        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()


class CompanyNames(unittest.TestCase):
    def test_a_slug_that_doesnt_read_as_a_name_is_written_out(self):
        jobs = src.parse_ashby("toogoodtogo", {"jobs": [{"id": 1, "title": "Frontend Engineer", "location": "Copenhagen", "jobUrl": "https://x.example/1"}]})
        self.assertEqual(jobs[0].company, "Too Good To Go")

    def test_written_out_names_still_match_a_register(self):
        self.assertEqual(company_key("CM.com"), company_key("CM.com International B.V."))
        self.assertEqual(company_key("Lightspeed"), company_key("Lightspeed Netherlands B.V."))


class OtherSites(unittest.TestCase):
    def test_relocate_sitemap(self):
        xml = """<urlset>
        <url><loc>https://relocate.me/netherlands/amsterdam/acme-corp/senior-frontend-engineer-123</loc></url>
        <url><loc>https://relocate.me/japan/tokyo/acme/frontend-engineer-124</loc></url>
        <url><loc>https://relocate.me/denmark/copenhagen/acme/backend-engineer-125</loc></url>
        </urlset>"""
        jobs = src.parse_relocate_sitemap(xml)
        self.assertEqual([j.title for j in jobs], ["Senior Frontend Engineer"])
        self.assertEqual(jobs[0].company, "Acme Corp")
        self.assertTrue(jobs[0].relocation_stated)

    def test_nav_list_keeps_norwegian_titles_and_drops_clear_misses(self):
        html = """<a class="l" href="/stillinger/stilling/b1be2bad-3afa-4112-964b-b44766553b6d">Utvikler til Design</a>
                  <a href="/stillinger/stilling/c1be2bad-3afa-4112-964b-b44766553b6d">Digdir søker backend- og plattformutvikler</a>"""
        self.assertEqual([j.title for j in src.parse_nav_list(html)], ["Utvikler til Design"])

    def test_nav_detail(self):
        html = "<h1>T</h1><p>Arbeidsgiver Acme AS</p><p>Sted Oslo</p><p>Om jobben</p><p>Arbeidsspråk Engelsk</p><p>Vis flere detaljer</p><p>Om stillingen</p><p>Build things</p>"
        detail = src.parse_nav_detail(html)
        self.assertEqual((detail["company"], detail["location"]), ("Acme AS", "Oslo"))
        self.assertTrue(detail["english_stated"])
        self.assertIn("Build things", detail["description"])

    def test_nav_with_norwegian_too_is_not_marked_english_only(self):
        detail = src.parse_nav_detail("<p>Arbeidsgiver A</p><p>Sted Oslo</p><p>Om jobben</p><p>Arbeidsspråk Norsk, Engelsk</p><p>Vis flere</p>")
        self.assertNotIn("english_stated", detail)

    def test_job_posting_markup(self):
        html = '<script type="application/ld+json">{"@type": "JobPosting", "datePosted": "2026-10-01T00:00:00", "description": "<b>About</b>\n&lt;p&gt;Text&lt;/p&gt;"}</script>'
        detail = src.parse_job_posting(html)
        self.assertEqual(detail["posted"], "2026-10-01")
        self.assertEqual(" ".join(detail["description"].split()), "About Text")

    def test_detail_never_fetches_a_stored_foreign_url(self):
        calls = []
        original = src._get
        src._get = lambda url: calls.append(url) or ""
        try:
            self.assertEqual(src.load_detail({"kind": "relocate", "url": "http://169.254.169.254/latest"}), {})
            self.assertEqual(src.load_detail({"kind": "nav", "id": "../../admin"}), {})
        finally:
            src._get = original
        self.assertEqual(calls, [])


class LocalLanguage(unittest.TestCase):
    def test_norwegian_dutch_and_danish_ads(self):
        norwegian = "Vi søker en erfaren utvikler som vil jobbe med oss. Du har erfaring og skal være med i et team som er på vei til det neste, og vi har det bra. " * 3
        dutch = "Wij zoeken een ervaren ontwikkelaar voor het team. Je gaat werken met de nieuwste technologie en bij ons heb je ook de ruimte om van een functie te groeien naar de volgende. " * 3
        danish = "Vi søger en erfaren udvikler til vores team. Du kan arbejde hos os og det er for dig som har erfaring med at bygge og som er god til at samarbejde med de andre. " * 3
        for text in (norwegian, dutch, danish):
            self.assertTrue(src.written_in_local_language(text), text[:30])

    def test_english_ad_with_a_dutch_location_is_not_local(self):
        english = "We are looking for a front-end engineer to join our team in Amsterdam. You will work with React and your experience is a plus for the team and the product we are building. " * 3
        self.assertFalse(src.written_in_local_language(english))

    def test_too_short_to_tell(self):
        self.assertFalse(src.written_in_local_language("Vi søker en utvikler"))


class Cv(unittest.TestCase):
    def test_not_a_pdf(self):
        with self.assertRaises(HTTPException) as caught:
            extract_cv_text(b"hello")
        self.assertEqual(caught.exception.status_code, 422)

    def test_damaged_pdf_gets_a_message(self):
        with self.assertRaises(HTTPException) as caught:
            extract_cv_text(b"%PDF-1.7 this is not really a pdf")
        self.assertEqual(caught.exception.status_code, 422)

    def test_reads_the_text_of_a_real_pdf(self):
        from io import BytesIO

        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        writer = PdfWriter()
        page = writer.add_blank_page(width=600, height=800)
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        lines = " ".join(f"(React and TypeScript developer line {i}) Tj T*" for i in range(12))
        stream.set_data(f"BT /F1 10 Tf 14 TL 50 750 Td {lines} ET".encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
        out = BytesIO()
        writer.write(out)
        text = extract_cv_text(out.getvalue())
        self.assertIn("React and TypeScript developer line 11", text)

    def test_a_pdf_with_no_text_is_refused(self):
        from io import BytesIO

        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        out = BytesIO()
        writer.write(out)
        with self.assertRaises(HTTPException) as caught:
            extract_cv_text(out.getvalue())
        self.assertIn("scan", caught.exception.detail)


class Assessments(unittest.TestCase):
    def item(self, job_id="a"):
        return {"job_id": job_id, "match": 80, "language": "english_ok", "relocation": "offered", "summary": "Fits", "strengths": ["React"], "gaps": []}

    def test_must_cover_exactly_the_jobs_asked_about(self):
        ctx = {"lang": "en", "ids": ["a", "b"]}
        with self.assertRaises(ValidationError):
            JobAssessments.model_validate({"items": [self.item("a")]}, context=ctx)
        with self.assertRaises(ValidationError):
            JobAssessments.model_validate({"items": [self.item("a"), self.item("z")]}, context=ctx)
        self.assertEqual(len(JobAssessments.model_validate({"items": [self.item("a"), self.item("b")]}, context=ctx).items), 2)

    def test_score_stays_in_range(self):
        with self.assertRaises(ValidationError):
            JobAssessments.model_validate({"items": [{**self.item(), "match": 101}]})


class Conn:
    """Enough of a database for save_found: remembers what was written."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.inserted = []
        self.updated = []
        self.profile = None

    def execute(self, sql, params=None):
        if sql.startswith("SELECT id, data"):
            return SimpleNamespace(fetchall=lambda: self.rows)
        if "INSERT INTO job_search_jobs" in sql:
            self.inserted.append(params)
        elif "UPDATE job_search_jobs" in sql:
            self.updated.append(params)
        elif "job_search_profiles" in sql:
            self.profile = params
        return SimpleNamespace(fetchone=lambda: None)

    def commit(self):
        pass


def raw(source="greenhouse", external="1", company="Acme", title="Frontend Engineer", **kw):
    return RawJob(source=source, external_id=external, title=title, company=company, location="Amsterdam", country="NL", url="https://x.example", **kw)


class Saving(unittest.TestCase):
    def test_new_job_is_added(self):
        conn = Conn()
        save_found(conn, 1, [raw()], [SourceResult("companies", True, 1)])
        self.assertEqual(len(conn.inserted), 1)

    def test_known_job_is_only_touched(self):
        job = raw()
        conn = Conn([(job.id, job.to_data())])
        save_found(conn, 1, [job], [])
        self.assertEqual(conn.inserted, [])
        self.assertEqual(len(conn.updated), 1)

    def test_same_job_on_two_sites_is_one_row_and_keeps_what_each_says(self):
        board, visa = raw(), raw(source="visajobs", external="z", company="ACME", title="Frontend  Engineer", relocation_stated=True, visa_stated=True)
        conn = Conn()
        save_found(conn, 1, [board, visa], [])
        self.assertEqual(len(conn.inserted), 1)
        merged = conn.updated[0][0].obj
        self.assertTrue(merged["relocation_stated"] and merged["visa_stated"])


def register_page(*names, filler=100):
    rows = "".join(f'<tr><th scope="row">{n}</th><td>{10000000 + i}</td></tr>' for i, n in enumerate(names))
    rows += "".join(f"<tr><td><p>Filler {i} A/S&nbsp;</p></td><td><p>{i}&nbsp;</p></td></tr>" for i in range(filler))
    return f'<table><tr><th scope="col">Organisation</th><th scope="col">KVK number</th></tr>{rows}</table>'


class Sponsors(unittest.TestCase):
    def test_legal_forms_and_generic_endings_dont_matter(self):
        for official, listed_as in (("Picnic Technologies B.V.", "Picnic"), ("Pleo Technologies ApS", "Pleo"), ("Trustpilot A/S", "Trustpilot"), ("Adyen N.V.", "Adyen")):
            self.assertEqual(company_key(official), company_key(listed_as), official)

    def test_a_different_company_with_a_similar_name_is_no_match(self):
        for official, listed_as in (("Booking Experts B.V.", "Booking.com"), ("Gradyent B.V.", "Adyen"), ("elasticsearch B.V.", "Elastic"), ("Picnic Foods B.V.", "Picnic")):
            self.assertNotEqual(company_key(official), company_key(listed_as), official)

    def test_nothing_comparable_left_never_matches(self):
        self.assertEqual(company_key("International Technologies B.V."), "")
        self.assertEqual(company_key(""), "")

    def test_reads_both_registers_shapes_and_skips_the_header(self):
        companies = parse_register(register_page("Mollie B.V.", "Tom &amp; Jerry B.V."))
        self.assertEqual(companies["mollie"], "Mollie B.V.")
        self.assertEqual(companies["tom and jerry"], "Tom & Jerry B.V.")
        self.assertEqual(companies["filler 3"], "Filler 3 A/S")
        self.assertNotIn("organisation", companies)

    def test_a_page_that_changed_is_a_failure_not_an_empty_register(self):
        with self.assertRaises(src.SourceError):
            parse_register(register_page("Mollie B.V.", filler=5))

    def job(self, job_id, country="NL", company="Mollie", **extra):
        return (job_id, {"country": country, "company": company, **extra})

    def test_marks_a_listed_company(self):
        conn = Conn([self.job("a")])
        apply_sponsors(conn, 1, {"NL": {"mollie": "Mollie B.V."}})
        self.assertEqual(conn.updated[0][0].obj, {"sponsor": {"name": "Mollie B.V.", "registry": "IND"}})

    def test_a_register_is_only_used_for_its_own_country(self):
        conn = Conn([self.job("a", country="DK")])
        apply_sponsors(conn, 1, {"NL": {"mollie": "Mollie B.V."}, "DK": {}})
        self.assertEqual(conn.updated, [])

    def test_a_company_that_left_the_register_loses_the_mark(self):
        conn = Conn([self.job("a", sponsor={"name": "Mollie B.V.", "registry": "IND"})])
        apply_sponsors(conn, 1, {"NL": {}})
        self.assertEqual(conn.updated[0][0].obj, {"sponsor": None})

    def test_a_register_that_failed_changes_nothing(self):
        conn = Conn([self.job("a", sponsor={"name": "Mollie B.V.", "registry": "IND"}), self.job("b", country="NO")])
        apply_sponsors(conn, 1, {})
        self.assertEqual(conn.updated, [])

    def test_unchanged_rows_arent_written(self):
        conn = Conn([self.job("a", sponsor={"name": "Mollie B.V.", "registry": "IND"})])
        apply_sponsors(conn, 1, {"NL": {"mollie": "Mollie B.V."}})
        self.assertEqual(conn.updated, [])


class View(unittest.TestCase):
    NOW = datetime(2026, 11, 6, tzinfo=timezone.utc)

    def test_sponsor_reaches_the_page(self):
        sponsor = {"name": "Mollie B.V.", "registry": "IND"}
        self.assertEqual(self.view(sponsor=sponsor).sponsor.name, "Mollie B.V.")
        self.assertIsNone(self.view().sponsor)

    def view(self, **data):
        base = {"source": "x", "title": "t", "company": "c", "location": "l", "country": "NL", "url": "https://x.example"}
        return _view("a" * 20, {**base, **data}, "new", self.NOW, self.NOW, None, self.NOW)

    def test_a_site_stating_relocation_beats_the_ads_silence(self):
        self.assertEqual(self.view(relocation_stated=True, assessment={"relocation": "not_mentioned"}).relocation, "offered")

    def test_stated_english_never_overrides_a_found_requirement(self):
        self.assertEqual(self.view(english_stated=True).language, "english_ok")
        self.assertEqual(self.view(english_stated=True, assessment={"language": "local_required"}).language, "local_required")


if __name__ == "__main__":
    unittest.main()
