"""A genre a catalogue lists twice counts once. Run: python -m unittest discover -s tests"""

import unittest

from app.library.schemas import LibraryDetails, LibraryItem, LibraryResponse


class UniqueGenres(unittest.TestCase):
    def test_a_saved_book_keeps_each_genre_once_in_its_first_spelling(self):
        item = LibraryItem(id="mythos", genres=["Mythology", "greek", "Mythology", " mythology ", "", "Gods"])
        self.assertEqual(item.genres, ["Mythology", "greek", "Gods"])

    def test_catalogue_details_come_without_repeats(self):
        details = LibraryDetails(source="google", source_id="1", title="Mindfuck", genres=["Fiction", "Fiction", "general"])
        self.assertEqual(details.genres, ["Fiction", "general"])

    def test_books_saved_with_repeats_before_are_read_without_them(self):
        res = LibraryResponse(items=[{"id": "a", "genres": ["Fiction", "Fiction"]}])
        self.assertEqual(res.items[0].genres, ["Fiction"])


if __name__ == "__main__":
    unittest.main()
