"""Synthetic regressions; never embed actual trainee records or quiz answers."""
import unittest
from pathlib import Path
from unittest.mock import patch

import import_legacy as legacy


class MigrationTests(unittest.TestCase):
    def person(self, **changes):
        values = dict(address="trainee@example.invalid", name="Example Trainee", roll="ABC-1", phone="", user_type="KEC Student", organization="KEC", source_key="authorized-users:2")
        values.update(changes)
        return values

    def test_email_case_and_space_use_one_identity(self):
        people, issues = {}, []
        first = legacy.add_person(people, issues, **self.person())
        second = legacy.add_person(people, issues, **self.person(address=" TRAINEE@EXAMPLE.INVALID ", source_key="authorized-users:3"))
        self.assertEqual(first, second)
        self.assertEqual(len(people), 1)
        self.assertTrue(any(issue["kind"] == "duplicate_email" for issue in issues))

    def test_missing_email_is_inactive_not_a_new_bookable_person(self):
        people, issues = {}, []
        legacy.add_person(people, issues, **self.person(address=""))
        person = next(iter(people.values()))
        self.assertFalse(person["active"])
        self.assertFalse(person["booking_privilege_active"])

    def test_invalid_email_is_quarantined(self):
        people, issues = {}, []
        legacy.add_person(people, issues, **self.person(address="a b@example.invalid"))
        self.assertFalse(next(iter(people.values()))["active"])

    def test_name_alone_never_transfers_certifications(self):
        people, issues = {}, []
        legacy.add_person(people, issues, **self.person())
        self.assertEqual(legacy.find_existing_email(people, "Example Trainee", "WRONG"), "")
        self.assertEqual(legacy.find_existing_email(people, "Example Trainee", ""), "")
        self.assertEqual(legacy.find_existing_email(people, "Example Trainee", "ABC-1"), "trainee@example.invalid")

    def model(self, result="PASS", grant="GRANTED", permission=False):
        rows = {
            "Authorized Users": [(2, {"Email": "trainee@example.invalid", "Full Name": "Example Trainee", "Roll No": "ABC-1", "User Type": "KEC Student", "Active": True, "Laser Cutter (Katrina)": permission})],
            "Training Results": [(2, {"Training": "Laser Cutting", "Source Response ID": "1", "Name": "Example Trainee", "Email": "trainee@example.invalid", "Roll No / External ID": "ABC-1", "User Type": "KEC Student", "Result": result, "Score": 18 if result == "PASS" else 15, "Max Score": 20, "Pass Mark": 16, "Grant Status": grant})],
        }
        with patch.object(legacy, "find_one", return_value=Path("synthetic")), patch.object(legacy, "parse_quiz_bank", return_value={"Laser Cutting": [], "3D Printing": []}), patch.object(legacy, "quiz_response_rows", return_value={}), patch.object(legacy, "rows_by_header", side_effect=lambda _, sheet: rows.get(sheet, [])):
            return legacy.build_model(Path("synthetic"), False)

    def test_existing_pass_counts_without_new_quiz(self):
        model, summary, _ = self.model()
        self.assertEqual(summary["people_with_recognized_equipment_training"], 1)
        self.assertEqual(model["certifications"][0]["certification_slug"], "laser-cutting")
        self.assertFalse(model["people"][0]["metadata"]["training_retake_required"])

    def test_permission_and_pass_are_not_duplicate_certifications(self):
        model, _, _ = self.model(permission=True)
        self.assertEqual(len(model["certifications"]), 1)
        self.assertEqual(model["certifications"][0]["source_kind"], "legacy_training_result")

    def test_old_permission_survives_a_later_failed_attempt(self):
        model, _, _ = self.model(result="FAIL", grant="FAILED - NO ACCESS", permission=True)
        self.assertEqual(model["certifications"][0]["source_kind"], "legacy_permission")
        self.assertEqual(model["certifications"][0]["status"], "active")

    def test_pass_awaiting_details_keeps_pass_without_unapproved_access(self):
        model, _, issues = self.model(grant="REVIEW - MISSING ROLL NO")
        self.assertTrue(model["attempts"][0]["passed"])
        self.assertFalse(model["people"][0]["metadata"]["training_retake_required"])
        self.assertEqual(model["certifications"], [])
        self.assertTrue(any(issue["kind"] == "passed_without_grant" for issue in issues))

    def test_equipment_pass_does_not_fabricate_safety_waiver_or_age(self):
        model, _, _ = self.model()
        person = model["people"][0]
        for field in ["safety_training_status", "waiver_status", "minor_status"]:
            self.assertEqual(person[field], "unknown")

    def test_repeated_models_have_stable_ids(self):
        first, _, _ = self.model()
        second, _, _ = self.model()
        for collection in ["people", "attempts", "certifications"]:
            self.assertEqual([row["id"] for row in first[collection]], [row["id"] for row in second[collection]])


if __name__ == "__main__":
    unittest.main()
