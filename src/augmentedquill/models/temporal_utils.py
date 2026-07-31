# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Shared temporal value normalization utilities.

Used by scene and sourcebook models to normalize ISO-like date/time strings
from user or LLM input into a consistent representation.
"""

from __future__ import annotations

import re
from datetime import datetime

_BRACKET_TOKEN_RE = re.compile(r"\[[^\]]+\]")
_DATE_ONLY_RE = re.compile(r"^[+-]?\d{4,}-\d{2}-\d{2}$")
_DATE_TIME_MINUTE_RE = re.compile(
    r"^(?P<prefix>[+-]?\d{4,}-\d{2}-\d{2}[T ]\d{2}:\d{2})(?P<suffix>Z|[+-]\d{2}:?\d{2})?$"
)
_OFFSET_NO_COLON_RE = re.compile(r"([+-]\d{2})(\d{2})$")
# Matches time-only patterns: HH:MM, HH:MM:SS, with optional timezone or Z suffix
_TIME_ONLY_RE = re.compile(
    r"^(?P<time>\d{2}:\d{2}(?::\d{2})?)(?P<tz>Z|[+-]\d{2}:?\d{2})?$"
)


def normalize_temporal_value(raw_value: str) -> str:
    """Normalize common date/time shorthand into a stable ISO-like string.

    Accepted shorthand examples:

    Date-only:
    - ``1985-11-05``              → ``1985-11-05T12:00:00Z``

    Date + Time:
    - ``1985-11-05T20:00``        → ``1985-11-05T20:00:00Z``
    - ``1985-11-05 20:00``        → ``1985-11-05T20:00:00Z``
    - ``1985-11-05T20:00:00``     → ``1985-11-05T20:00:00Z``
    - ``1985-11-05T20:00:00+01:00`` → unchanged (already valid)

    Time-only (uses current date, defaults to UTC):
    - ``14:30``                   → ``YYYY-MM-DDTHH:14:30:00Z``
    - ``14:30:45``                → ``YYYY-MM-DDTHH:14:30:45Z``
    - ``14:30Z``                  → ``YYYY-MM-DDTHH:14:30:00Z``
    - ``14:30:45+05:30``          → ``YYYY-MM-DDTHH:14:30:45+05:30``
    - ``14:30+01:00``             → ``YYYY-MM-DDTHH:14:30:00+01:00``

    When partial datetime is provided, missing components are filled:
    - Missing seconds default to `:00`
    - Missing timezone defaults to `Z` (UTC)
    - Missing date uses the current date (YYYY-MM-DD)
    """
    value = raw_value.strip()
    if not value:
        raise ValueError("temporal value cannot be empty")

    # Check for time-only input first
    time_match = _TIME_ONLY_RE.fullmatch(value)
    if time_match:
        time_part = time_match.group("time")
        tz_part = time_match.group("tz") or "Z"
        # Add seconds if not provided
        if ":" in time_part and time_part.count(":") == 1:
            time_part = f"{time_part}:00"
        # Use current date
        today = datetime.now().strftime("%Y-%m-%d")
        normalized = f"{today}T{time_part}{tz_part}"
        # Normalize timezone offset (ensure colon format)
        if _OFFSET_NO_COLON_RE.search(normalized):
            normalized = _OFFSET_NO_COLON_RE.sub(r"\1:\2", normalized)
        return normalized

    if _DATE_ONLY_RE.fullmatch(value):
        return f"{value}T12:00:00Z"

    normalized = value.replace(" ", "T", 1)
    minute_match = _DATE_TIME_MINUTE_RE.fullmatch(normalized)
    if minute_match:
        prefix = minute_match.group("prefix")
        suffix = minute_match.group("suffix") or "Z"
        normalized = f"{prefix}:00{suffix}"

    if normalized.endswith("z"):
        normalized = f"{normalized[:-1]}Z"

    if _OFFSET_NO_COLON_RE.search(normalized):
        normalized = _OFFSET_NO_COLON_RE.sub(r"\1:\2", normalized)

    base_no_brackets = _BRACKET_TOKEN_RE.sub("", normalized)
    has_offset_or_z = bool(re.search(r"(Z|[+-]\d{2}:\d{2})$", base_no_brackets))
    if "T" in base_no_brackets and not has_offset_or_z:
        normalized = f"{normalized}Z"

    return normalized
