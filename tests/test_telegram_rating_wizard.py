import unittest
from tools.telegram_rating_wizard import Draft, STAR

class WizardTests(unittest.TestCase):
    def test_only_enabled_and_explicitly_chosen(self):
        d = Draft("750206")
        d.begin_rating(["grade5", "grade1", "indi"])
        d.set_choice("isFair", "Y")
        d.select_five("grade1")
        with self.assertRaises(ValueError): d.select_five("grade2")
        d.set_choice("indi", "yes")
        preview = d.rating_preview({"grade1": "Общая оценка"})
        self.assertIn("Общая оценка — " + STAR, preview)
        self.assertNotIn("grade2", preview)
        self.assertEqual(d.confirm()["ratings"], {"grade1":"5"})

    def test_incompatible_photo_choice_resets_ratings(self):
        d = Draft("750206")
        d.begin_rating(["grade1"])
        d.set_choice("isFair", "Y")
        d.select_five("grade1")
        d.set_choice("isFair", "N")
        self.assertEqual(d.selected_fives, set())

    def test_review_requires_explicit_confirmation(self):
        d = Draft("750206")
        d.begin_review()
        preview = d.set_review("Это мой реальный опыт.")
        self.assertIn("Отправляем?", preview)
        self.assertFalse(d.approved)
        result = d.confirm()
        self.assertTrue(d.approved)
        self.assertEqual(result["review_text"], "Это мой реальный опыт.")

if __name__ == "__main__":
    unittest.main()
