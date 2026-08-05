# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""High-level test: create the Back to the Future trilogy as a time-travel story.

The story is created through the single shared seed
``augmentedquill.testing.back_to_the_future`` — the same code path that the
docs screenshot pipeline uses to produce the Convergence Map screenshot — so
this test doubles as the verification that the screenshot's data is correct.

It checks that the scenes feature holds a series with one book per movie,
twenty-two scenes whose in-story times jump across 1885 / 1955 / 1985 / 2015,
that the time-travel branches get their own timelines instead of all sharing
``main`` (universal rule: a trip to the PAST always opens a branch, a trip to
the FUTURE stays on the same line), that each branch starts off a timeline
that exists at the branch's creation moment (the first 1955 line hosts the two
Nov 12 1955 branches, Old Biff's 1955 hosts the alternate 1985, Doc's 1885
hosts Marty's Old West line, and the P1 1955 / Doc's 1885 fall back to
``main`` — the Convergence Map's "common ancestor" rule), that scenes from one
movie share a ``color_tag`` so a chronologically sorted view groups them by
movie, that the characters whose scenes draw the Convergence Map lanes exist,
and that every one of the 14
time-travel events across the trilogy is modelled as a ``Time Travel``
sourcebook entry so the Convergence Map can draw the branch spawn arcs and
jump arrows on its left-hand timeline panel.
"""

import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from augmentedquill.services.projects.projects import get_active_project_dir
from augmentedquill.services.scenes.scene_service import list_scenes
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_list_entries,
)
from augmentedquill.testing.back_to_the_future import (
    CHARACTERS,
    SCENES,
    seed_back_to_the_future_trilogy,
)

# Branch lanes are named ``branch:<jump entry name>`` so the Convergence Map
# timeline panel can draw each branch's spawn arc from the entry that creates
# it.  Only the original 1985 (Timeline 1: Einstein's test run + the Libyan
# attack) stays on ``main`` — every later scene lives on an altered line.
BRANCH_TIMELINES: dict[str, str] = {
    "Arrival in 1955": "branch:1985 -> 1955",
    "Enchantment Under the Sea": "branch:1985 -> 1955",
    "Lightning Sends Marty Home": "branch:1985 -> 1955",
    "Trip to the Future (2015)": "branch:1985 -> 1955",
    "Hill Valley 2015": "branch:1985 -> 1955",
    "Old Biff Steals the DeLorean": "branch:1985 -> 1955",
    "Alternate 1985 (1985A)": "branch:2015 -> 1985A",
    "Go Back to 1955": "branch:2015 -> 1985A",
    "Old Biff Gives the Almanac": "branch:2015 -> 1955",
    "Old Biff Returns to 2015": "branch:2015 -> 1955",
    "The Return to Hell Valley": "branch:2015 -> 1955",
    "Return to 1955": "branch:1985A -> 1955",
    "Doc Struck by Lightning": "branch:1985A -> 1955",
    "Marty Leaves for the Old West": "branch:1985A -> 1955",
    "Doc Arrives in 1885": "branch:1955 -> 1885",
    "Marty Arrives in the Old West": "branch:1955 -> 1885 (Marty)",
    "Marty Departs the Old West": "branch:1955 -> 1885 (Marty)",
    "Doc Builds the Time Train": "branch:1955 -> 1885 (Marty)",
    "The Return Home": "branch:1955 -> 1885 (Marty)",
    "The Time Train Arrives": "branch:1955 -> 1885 (Marty)",
}

# One Time Travel sourcebook entry per DeLorean jump / time-travel event.
# Every branch-creating jump names its new timeline ``branch:<name>`` (the
# default the sourcebook service assigns) and the scenes that land on that
# branch use the same id, so the Convergence Map timeline panel draws a spawn
# arc + arrow for every jump.
#
# ``timeline_id`` is the line the event belongs to: for a branch it is the
# branch's parent (the timeline that exists at the branch's creation moment —
# when the direct departure timeline, 2015 / 1985-A, does not exist there, the
# parent is the line that does); for a non-branching jump it is the line the
# arrow departs from (the sourcebook only stores ``timeline_id`` for branch
# entries, but the seed keeps it accurate for both).
TIME_TRAVELS: dict[str, dict[str, object]] = {
    "Einstein's Test Run": {
        "origin_date": "1985-10-26T01:18:00Z",
        "destination_datetime": "1985-10-26T01:19:00Z",
        "creates_new_timeline": False,
        "timeline_id": "main",
    },
    "1985 -> 1955": {
        "origin_date": "1985-10-26T01:35:00Z",
        "destination_datetime": "1955-11-05T06:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "main",
    },
    "1955 -> 1985": {
        "origin_date": "1955-11-12T22:04:00Z",
        "destination_datetime": "1985-10-26T01:24:00Z",
        "creates_new_timeline": False,
        "timeline_id": "branch:1985 -> 1955",
    },
    "2015 -> 1985": {
        "origin_date": "2015-10-21T16:30:00Z",
        "destination_datetime": "1985-10-26T10:28:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:1985 -> 1955",
    },
    "1985 -> 2015 (the trio)": {
        "origin_date": "1985-10-26T10:29:00Z",
        "destination_datetime": "2015-10-21T16:29:00Z",
        "creates_new_timeline": False,
        "timeline_id": "branch:1985 -> 1955",
    },
    "2015 -> 1955": {
        "origin_date": "2015-10-21T18:00:00Z",
        "destination_datetime": "1955-11-12T14:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:1985 -> 1955",
    },
    "1955 -> 2015": {
        "origin_date": "1955-11-12T18:38:00Z",
        "destination_datetime": "2015-10-21T18:38:00Z",
        "creates_new_timeline": False,
        "timeline_id": "branch:2015 -> 1955",
    },
    "2015 -> 1985A": {
        "origin_date": "2015-10-21T19:28:00Z",
        "destination_datetime": "1985-10-26T09:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:2015 -> 1955",
    },
    "1985A -> 1955": {
        "origin_date": "1985-10-27T02:42:00Z",
        "destination_datetime": "1955-11-12T06:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:1985 -> 1955",
    },
    "1955 -> 1885": {
        "origin_date": "1955-11-12T21:44:00Z",
        "destination_datetime": "1885-01-01T00:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "main",
    },
    "1955 -> 1885 (Marty)": {
        "origin_date": "1955-11-16T10:00:00Z",
        "destination_datetime": "1885-09-02T08:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:1955 -> 1885",
    },
    "1885 -> 1985": {
        "origin_date": "1885-09-07T09:00:00Z",
        "destination_datetime": "1985-10-27T11:00:00Z",
        "creates_new_timeline": False,
        "timeline_id": "branch:1955 -> 1885 (Marty)",
    },
    "1885 -> 1985 (the Time Train)": {
        "origin_date": "1885-09-08T12:00:00Z",
        "destination_datetime": "1985-10-27T12:00:00Z",
        "creates_new_timeline": False,
        "timeline_id": "branch:1955 -> 1885 (Marty)",
    },
    "The Time Train Departs": {
        "origin_date": "1985-10-27T12:00:00Z",
        "destination_datetime": None,
        "creates_new_timeline": False,
        "timeline_id": "branch:1955 -> 1885 (Marty)",
    },
}

# The parent of every branch timeline.  Each branch starts off a timeline that
# exists at the moment it is created: the two Nov 12 1955 branches (Old Biff's
# divergent 1955 and the restored 1955 Doc/Marty return to) branch off the
# first 1955 line; the alternate 1985 branches off Old Biff's 1955; Marty's
# 1885 opens a second Old West line off Doc's 1885; and the P1 1955 and Doc's
# 1885 branch off main (their direct departure timeline, 2015 / 1985-A, does
# not exist at the branch's creation moment).  A return to the FUTURE (1885 ->
# 1985) is not a branch.
BRANCH_PARENTS: dict[str, str] = {
    "1985 -> 1955": "main",
    "2015 -> 1955": "branch:1985 -> 1955",
    "2015 -> 1985": "branch:1985 -> 1955",
    "2015 -> 1985A": "branch:2015 -> 1955",
    "1985A -> 1955": "branch:1985 -> 1955",
    "1955 -> 1885": "main",
    "1955 -> 1885 (Marty)": "branch:1955 -> 1885",
}

# Per-movie color tags (blue = Part I, orange = Part II, green = Part III).
MOVIE_COLORS: dict[str, set[str]] = {
    "blue": {
        "Einstein's Test Run",
        "The Libyan Attack",
        "Trip to the Future (2015)",
        "Arrival in 1955",
        "Enchantment Under the Sea",
        "Lightning Sends Marty Home",
    },
    "orange": {
        "Hill Valley 2015",
        "Old Biff Steals the DeLorean",
        "The Return to Hell Valley",
        "Alternate 1985 (1985A)",
        "Go Back to 1955",
        "Old Biff Gives the Almanac",
        "Old Biff Returns to 2015",
        "Return to 1955",
        "Doc Struck by Lightning",
    },
    "green": {
        "Marty Leaves for the Old West",
        "Doc Arrives in 1885",
        "Marty Arrives in the Old West",
        "Marty Departs the Old West",
        "Doc Builds the Time Train",
        "The Return Home",
        "The Time Train Arrives",
    },
}


class BackToTheFutureTimeTravelTest(TestCase):
    """Create the Back to the Future story and verify the scenes feature holds
    a time-travelling narrative across branching timelines."""

    def setUp(self) -> None:
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

    def tearDown(self) -> None:
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _load_story(self, project_dir: Path) -> dict:
        return json.loads((project_dir / "story.json").read_text(encoding="utf-8"))

    def test_creates_books_scenes_and_character_lanes(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        self.assertIsNotNone(project_dir)
        self.assertTrue((project_dir / "story.json").exists())

        # One book per movie, plus a chapter in each.
        story = self._load_story(project_dir)
        self.assertEqual(
            [book["title"] for book in story.get("books", [])],
            [
                "Back to the Future",
                "Back to the Future Part II",
                "Back to the Future Part III",
            ],
        )

        scenes = list_scenes(project_dir)
        self.assertEqual(len(scenes), 22)
        self.assertEqual({scene["id"] for scene in scenes}, set(range(1, 23)))

        # Every scene's characters exist as sourcebook Character entries so the
        # Convergence Map can draw one lane (snake) per character.
        entries = sourcebook_list_entries()
        entry_names = {entry["name"] for entry in entries}
        for name, _description, _origin, _synonyms in CHARACTERS:
            self.assertIn(name, entry_names)

    def test_time_travel_scene_times_are_non_monotonic(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        times = [scene["scene_time"]["temporal_zoned_datetime"] for scene in scenes]
        # Marty's story starts in 1985, jumps back to 1955, forward to 2015,
        # back to 1985A and 1955, then to 1885, then home — narrative order is
        # not chronologically sorted, which is exactly the time-travel signal.
        self.assertNotEqual(times, sorted(times))
        self.assertTrue(min(times).startswith("1885-01-01"))
        self.assertTrue(max(times).startswith("2015-10-21"))
        for scene in scenes:
            self.assertIn("T", scene["scene_time"]["temporal_zoned_datetime"])

    def test_time_travel_branches_use_their_own_timelines(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}
        # The future of 2015, the alternate 1985 (Biff's world) and the second
        # trip back to 1955 that fixes it, and the Old West of 1885 are all
        # branch timelines; only the trilogy's "present" scenes stay on main.
        for summary, expected_timeline in BRANCH_TIMELINES.items():
            self.assertEqual(by_summary[summary]["timeline_id"], expected_timeline)
        for scene in scenes:
            if scene["summary"] not in BRANCH_TIMELINES:
                self.assertEqual(scene["timeline_id"], "main")

    def test_creates_a_time_travel_entry_for_every_time_travel_event(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        self.assertIsNotNone(project_dir)
        entries = sourcebook_list_entries()
        tt_entries = {
            entry["name"]: entry
            for entry in entries
            if entry["category"] == "Time Travel"
        }
        # One entry per time-travel event across the trilogy (14 events).  These
        # drive the Convergence Map timeline panel: every entry becomes a jump
        # arrow, and every branch-creating entry draws the branch's spawn arc.
        self.assertEqual(set(tt_entries), set(TIME_TRAVELS))
        for name, expected in TIME_TRAVELS.items():
            entry = tt_entries[name]
            self.assertEqual(entry["origin_date"], expected["origin_date"])
            self.assertEqual(
                entry["destination_datetime"], expected["destination_datetime"]
            )
            self.assertEqual(
                entry["creates_new_timeline"], expected["creates_new_timeline"]
            )

    def test_past_travels_always_branch_future_travels_stay(self) -> None:
        """UNIVERSAL RULE, checked mechanically on the real story data.

        A time travel to the PAST always opens a new timeline; a time travel to
        the FUTURE stays on the same line.  For every Time Travel entry whose
        origin and destination are both known, assert the ``creates_new_timeline``
        flag matches the direction of travel — so no backward travel can ever be
        left without its own branch.
        """
        from datetime import UTC, datetime

        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}
        entries = sourcebook_list_entries()
        tt = {e["name"]: e for e in entries if e["category"] == "Time Travel"}

        def parse(iso: str) -> datetime:
            return datetime.fromisoformat(iso).astimezone(UTC)

        checked = 0
        for name, entry in tt.items():
            origin = entry.get("origin_date")
            destination = entry.get("destination_datetime")
            if not origin or not destination:
                # No destination (the Time Train Departs to parts unknown) -> the
                # direction is not determinable, so the rule cannot be checked.
                continue
            is_past = parse(destination) < parse(origin)
            self.assertEqual(
                entry["creates_new_timeline"],
                is_past,
                f"{name}: a travel {'to the PAST' if is_past else 'to the FUTURE'} "
                f"must {'open a new timeline' if is_past else 'stay on its line'}",
            )
            checked += 1

        # Every direction-determinable event was audited.
        self.assertEqual(checked, 13)

        # Spot checks on the scene placement implied by the rule.
        # Part II's 2015 is the future of the altered 1985 line.
        self.assertEqual(
            by_summary["Hill Valley 2015"]["timeline_id"], "branch:1985 -> 1955"
        )
        # The alternate 1985 is reached by a past travel -> its own branch.
        self.assertEqual(
            by_summary["Alternate 1985 (1985A)"]["timeline_id"],
            "branch:2015 -> 1985A",
        )
        # ``main`` holds ONLY the original 1985 (Timeline 1).
        self.assertEqual(by_summary["Einstein's Test Run"]["timeline_id"], "main")
        self.assertEqual(by_summary["The Libyan Attack"]["timeline_id"], "main")

    def test_every_branch_starts_off_a_timeline_that_exists_at_branch_time(
        self,
    ) -> None:
        """The Convergence Map "common ancestor" rule.

        A sub-timeline must start off a timeline that exists at the moment it
        branches.  The 1955 branches start off the first 1955 line (created Nov
        5, 1955), which exists when Old Biff's 1955 and the restored 1955 split
        off on Nov 12; the alternate 1985 is the future of Biff's 1955; Marty's
        1885 splits off Doc's 1885; and the P1 1955 and Doc's 1885 branch off
        main (their direct departure timeline, 2015 / 1985A, does not exist at
        the branch's creation moment, so the parent falls back to main).
        """
        seed_back_to_the_future_trilogy()
        entries = sourcebook_list_entries()
        by_name = {entry["name"]: entry for entry in entries}

        branch_entries = {
            name: entry
            for name, entry in by_name.items()
            if entry["category"] == "Time Travel" and entry["creates_new_timeline"]
        }
        self.assertEqual(set(branch_entries), set(BRANCH_PARENTS))
        for name, entry in branch_entries.items():
            self.assertEqual(entry["timeline_id"], BRANCH_PARENTS[name])

    def test_branch_scenes_live_on_the_branch_their_entry_creates(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        entries = sourcebook_list_entries()
        branch_scenes = {
            summary: timeline
            for summary, timeline in ((s["summary"], s["timeline_id"]) for s in scenes)
            if timeline != "main"
        }
        # Every branch lane is created by exactly one branch-creating entry whose
        # default destination timeline is ``branch:<name>``.
        branch_lanes: set[str] = set()
        for entry in entries:
            if entry["category"] != "Time Travel" or not entry["creates_new_timeline"]:
                continue
            branch_lanes.add(f"branch:{entry['name']}")
        self.assertTrue(set(branch_scenes.values()).issubset(branch_lanes))
        # Each branch lane holds at least one scene, EXCEPT
        # ``branch:2015 -> 1985`` (Doc's return to the present to warn): that is
        # a past travel that MUST fork per the universal rule, but it lands at
        # 10:28 on Oct 26, 1985 — the very end of the story — so it is a pure
        # divergence with no scenes on it.
        scene_less_branches = branch_lanes - set(branch_scenes.values())
        self.assertEqual(scene_less_branches, {"branch:2015 -> 1985"})

    def test_scenes_reference_their_departure_time_travel_entries(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}

        # Each jump is referenced only from its departure scene (the scene from
        # which the time machine leaves), so the timeline panel anchors the
        # arrow's departure to a real scene dot on the source timeline.
        self.assertIn(
            "Einstein's Test Run",
            by_summary["Einstein's Test Run"]["sourcebook_entry_ids"],
        )
        # Marty's jump to 1955 departs from the Libyan attack...
        self.assertIn(
            "1985 -> 1955", by_summary["The Libyan Attack"]["sourcebook_entry_ids"]
        )
        # ...and it is the ONLY travel that departs from that scene: Doc's Old
        # West trip leaves from 1955 (where he is struck by lightning), not from
        # the 1985 Libyan attack.
        self.assertEqual(
            set(by_summary["The Libyan Attack"]["sourcebook_entry_ids"]),
            {"1985 -> 1955"},
        )
        self.assertIn(
            "1985 -> 2015 (the trio)",
            by_summary["Trip to the Future (2015)"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "1955 -> 1985",
            by_summary["Lightning Sends Marty Home"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "2015 -> 1955",
            by_summary["Old Biff Steals the DeLorean"]["sourcebook_entry_ids"],
        )
        # Doc's return from 2015 (to warn Marty) departs from the Hill Valley
        # 2015 scene on the altered line, so its arrow is not left on main.
        self.assertIn(
            "2015 -> 1985",
            by_summary["Hill Valley 2015"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "2015 -> 1985A",
            by_summary["The Return to Hell Valley"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "1985A -> 1955", by_summary["Go Back to 1955"]["sourcebook_entry_ids"]
        )
        self.assertIn(
            "1955 -> 1885",
            by_summary["Doc Struck by Lightning"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "1955 -> 1885 (Marty)",
            by_summary["Marty Leaves for the Old West"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "1885 -> 1985",
            by_summary["Marty Departs the Old West"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "1885 -> 1985 (the Time Train)",
            by_summary["Doc Builds the Time Train"]["sourcebook_entry_ids"],
        )
        self.assertIn(
            "The Time Train Departs",
            by_summary["The Time Train Arrives"]["sourcebook_entry_ids"],
        )
        # Arrival scenes do not reference the jump: the timeline panel finds the
        # destination scene by its epoch on the branch timeline.
        self.assertEqual(by_summary["Arrival in 1955"]["sourcebook_entry_ids"], [])
        self.assertEqual(
            by_summary["Alternate 1985 (1985A)"]["sourcebook_entry_ids"], []
        )
        self.assertEqual(by_summary["Return to 1955"]["sourcebook_entry_ids"], [])
        self.assertEqual(by_summary["Doc Arrives in 1885"]["sourcebook_entry_ids"], [])

    def test_scenes_from_one_movie_share_a_color(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}
        # Scenes from the same movie use the same color_tag so a chronologically
        # sorted view (the Convergence Map) groups them visually by movie.
        for color, summaries in MOVIE_COLORS.items():
            for summary in summaries:
                self.assertEqual(by_summary[summary]["color_tag"], color)
        # All three movies are represented, and nothing else is.
        self.assertEqual(
            {scene["color_tag"] for scene in scenes}, set(MOVIE_COLORS.keys())
        )

    def test_characters_and_causal_chain_survive(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}
        # Characters are preserved per scene, including the alternate-1985
        # villain and Doc's family in the finale.
        alt = by_summary["Alternate 1985 (1985A)"]
        self.assertEqual(
            alt["active_characters"], ["Marty McFly", "Doc Brown", "Biff Tannen"]
        )
        dance = by_summary["Enchantment Under the Sea"]
        self.assertIn("Lorraine Baines", dance["active_characters"])
        finale = by_summary["The Time Train Arrives"]
        self.assertIn("Clara Clayton", finale["active_characters"])
        # Each scene carries the causal link to the story beat that triggers it.
        self.assertEqual(by_summary["The Libyan Attack"]["causes"], [1])
        self.assertEqual(by_summary["Arrival in 1955"]["causes"], [2])
        self.assertEqual(by_summary["Return to 1955"]["causes"], [11])
        self.assertEqual(by_summary["Doc Arrives in 1885"]["causes"], [14])
        self.assertEqual(by_summary["The Return Home"]["causes"], [18])

    def test_seed_creates_exactly_the_shared_scene_set(self) -> None:
        # The seed is the single source of truth: the test asserts the seed's own
        # data, and the number of scenes it creates matches that data.
        self.assertEqual(len(SCENES), 22)
        self.assertGreaterEqual(len(CHARACTERS), 3)
        project_dir = get_active_project_dir()
        if project_dir is None:
            project_dir = seed_back_to_the_future_trilogy()
        self.assertEqual(len(list_scenes(project_dir)), len(SCENES))
