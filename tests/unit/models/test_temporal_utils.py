# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for temporal value normalization utilities."""

import unittest
from datetime import datetime

from augmentedquill.models.temporal_utils import normalize_temporal_value


class NormalizeTemporalValueTest(unittest.TestCase):
    """Tests for normalize_temporal_value function."""

    # -----------------------------------------------------------------------
    # Date-only inputs (existing behavior)
    # -----------------------------------------------------------------------

    def test_date_only_becomes_noon_utc(self) -> None:
        """Date-only input should use 12:00:00 UTC."""
        result = normalize_temporal_value("1985-11-05")
        self.assertEqual(result, "1985-11-05T12:00:00Z")

    def test_date_only_with_negative_year(self) -> None:
        """Date with negative year should work."""
        result = normalize_temporal_value("-0001-01-01")
        self.assertEqual(result, "-0001-01-01T12:00:00Z")

    # -----------------------------------------------------------------------
    # Date + Time inputs (existing behavior)
    # -----------------------------------------------------------------------

    def test_date_time_with_space_separator(self) -> None:
        """Date and time separated by space should be normalized."""
        result = normalize_temporal_value("1985-11-05 20:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_date_time_iso_format(self) -> None:
        """ISO format date + time should add seconds and timezone."""
        result = normalize_temporal_value("1985-11-05T20:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_date_time_with_seconds(self) -> None:
        """Date + time with seconds should just ensure timezone."""
        result = normalize_temporal_value("1985-11-05T20:00:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_date_time_with_timezone(self) -> None:
        """Date + time with timezone should be unchanged."""
        result = normalize_temporal_value("1985-11-05T20:00:00+01:00")
        self.assertEqual(result, "1985-11-05T20:00:00+01:00")

    def test_date_time_timezone_without_colon(self) -> None:
        """Timezone offset without colon should be normalized."""
        result = normalize_temporal_value("1985-11-05T20:00:00+0100")
        self.assertEqual(result, "1985-11-05T20:00:00+01:00")

    def test_date_time_lowercase_z(self) -> None:
        """Lowercase 'z' should be converted to uppercase 'Z'."""
        result = normalize_temporal_value("1985-11-05T20:00:00z")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    # -----------------------------------------------------------------------
    # Time-only inputs (new behavior)
    # -----------------------------------------------------------------------

    def test_time_only_hh_mm(self) -> None:
        """Time-only HH:MM should use today's date, add seconds, use UTC."""
        result = normalize_temporal_value("14:30")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00Z")

    def test_time_only_hh_mm_ss(self) -> None:
        """Time-only HH:MM:SS should use today's date and UTC."""
        result = normalize_temporal_value("14:30:45")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:45Z")

    def test_time_with_z_timezone(self) -> None:
        """Time with 'Z' timezone should use today's date and UTC."""
        result = normalize_temporal_value("14:30Z")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00Z")

    def test_time_with_positive_offset(self) -> None:
        """Time with positive offset should use today's date."""
        result = normalize_temporal_value("14:30+05:30")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00+05:30")

    def test_time_with_negative_offset(self) -> None:
        """Time with negative offset should use today's date."""
        result = normalize_temporal_value("14:30-08:00")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00-08:00")

    def test_time_with_seconds_and_offset(self) -> None:
        """Time with seconds and offset should use today's date."""
        result = normalize_temporal_value("14:30:45+01:00")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:45+01:00")

    def test_time_with_offset_without_colon(self) -> None:
        """Time with offset without colon should be normalized."""
        result = normalize_temporal_value("14:30+0530")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00+05:30")

    # -----------------------------------------------------------------------
    # Edge cases and validation
    # -----------------------------------------------------------------------

    def test_empty_string_raises_error(self) -> None:
        """Empty string should raise ValueError."""
        with self.assertRaises(ValueError):
            normalize_temporal_value("")

    def test_whitespace_only_raises_error(self) -> None:
        """Whitespace-only string should raise ValueError."""
        with self.assertRaises(ValueError):
            normalize_temporal_value("   ")

    def test_midnight_time(self) -> None:
        """Midnight (00:00) should be valid."""
        result = normalize_temporal_value("00:00")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T00:00:00Z")

    def test_end_of_day_time(self) -> None:
        """23:59 should be valid."""
        result = normalize_temporal_value("23:59")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T23:59:00Z")

    # -----------------------------------------------------------------------
    # Documentation examples verification
    # -----------------------------------------------------------------------

    def test_doc_example_date_only(self) -> None:
        """Verify doc example: date-only."""
        result = normalize_temporal_value("1985-11-05")
        self.assertEqual(result, "1985-11-05T12:00:00Z")

    def test_doc_example_date_time_minute_space(self) -> None:
        """Verify doc example: date + time with space."""
        result = normalize_temporal_value("1985-11-05 20:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_doc_example_date_time_iso_minute(self) -> None:
        """Verify doc example: ISO date + time (minute precision)."""
        result = normalize_temporal_value("1985-11-05T20:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_doc_example_date_time_iso_seconds(self) -> None:
        """Verify doc example: ISO date + time + seconds."""
        result = normalize_temporal_value("1985-11-05T20:00:00")
        self.assertEqual(result, "1985-11-05T20:00:00Z")

    def test_doc_example_date_time_with_timezone(self) -> None:
        """Verify doc example: full ISO with timezone."""
        result = normalize_temporal_value("1985-11-05T20:00:00+01:00")
        self.assertEqual(result, "1985-11-05T20:00:00+01:00")

    def test_doc_example_time_hh_mm(self) -> None:
        """Verify doc example: time HH:MM."""
        result = normalize_temporal_value("14:30")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00Z")

    def test_doc_example_time_hh_mm_ss(self) -> None:
        """Verify doc example: time HH:MM:SS."""
        result = normalize_temporal_value("14:30:45")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:45Z")

    def test_doc_example_time_with_z(self) -> None:
        """Verify doc example: time with Z."""
        result = normalize_temporal_value("14:30Z")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00Z")

    def test_doc_example_time_with_seconds_offset(self) -> None:
        """Verify doc example: time with seconds and offset."""
        result = normalize_temporal_value("14:30:45+05:30")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:45+05:30")

    def test_doc_example_time_with_offset(self) -> None:
        """Verify doc example: time with offset."""
        result = normalize_temporal_value("14:30+01:00")
        today = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(result, f"{today}T14:30:00+01:00")


if __name__ == "__main__":
    unittest.main()
