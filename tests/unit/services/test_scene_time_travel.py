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

It checks that the scenes feature holds a series with one book per movie, ten
scenes whose in-story times jump across 1885 / 1955 / 1985 / 2015, that the
time-travel branches get their own timelines instead of all sharing ``main``,
that scenes from one movie share a ``color_tag`` so a chronologically sorted
view groups them by movie, that the characters whose scenes draw the
Convergence Map lanes exist, and that every DeLorean jump is modelled as a
``Time Travel`` sourcebook entry so the Convergence Map can draw the branch
spawn arcs and jump arrows on its left-hand timeline panel.
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

# Every outbound DeLorean jump opens a new timeline: only the trilogy's
# "present" scenes stay on ``main``.  Branch lanes are named
# ``branch:<jump entry name>`` so the Convergence Map timeline panel can draw
# each branch's spawn arc from the entry that creates it.
BRANCH_TIMELINES = {
    "Arrival in 1955": "branch:1985 -> 1955",
    "Enchantment Under the Sea": "branch:1985 -> 1955",
    "Lightning sends Marty home": "branch:1985 -> 1955",
    "Hill Valley 2015": "branch:1985 -> 2015",
    "Alternate 1985 (1985A)": "branch:2015 -> 1985A",
    "Return to 1955": "branch:1985A -> 1955",
    "The Old West, 1885": "branch:1985 -> 1885",
}

# One Time Travel sourcebook entry per DeLorean jump.  Every jump is
# branch-creating; the new timeline is named ``branch:<name>`` (the default the
# sourcebook service assigns) and the scenes that land on that branch use the
# same id, so the Convergence Map timeline panel draws a spawn arc + arrow for
# every jump.
TIME_TRAVELS: dict[str, dict[str, object]] = {
    "1985 -> 1955": {
        "origin_date": "1985-10-26T01:35:00Z",
        "destination_datetime": "1955-11-05T22:04:00Z",
        "creates_new_timeline": True,
        "timeline_id": "main",
    },
    "1985 -> 2015": {
        "origin_date": "1985-10-26T01:15:00Z",
        "destination_datetime": "2015-10-21T18:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "main",
    },
    "2015 -> 1985A": {
        "origin_date": "2015-10-21T18:00:00Z",
        "destination_datetime": "1985-10-27T09:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:1985 -> 2015",
    },
    "1985A -> 1955": {
        "origin_date": "1985-10-27T09:00:00Z",
        "destination_datetime": "1955-11-12T21:30:00Z",
        "creates_new_timeline": True,
        "timeline_id": "branch:2015 -> 1985A",
    },
    "1985 -> 1885": {
        "origin_date": "1985-10-26T01:35:00Z",
        "destination_datetime": "1885-09-02T12:00:00Z",
        "creates_new_timeline": True,
        "timeline_id": "main",
    },
}

# Per-movie color tags (blue = Part I, orange = Part II, green = Part III).
MOVIE_COLORS = {
    "blue": {
        "Twin Pines Mall",
        "The Libyan attack",
        "Arrival in 1955",
        "Enchantment Under the Sea",
        "Lightning sends Marty home",
    },
    "orange": {"Hill Valley 2015", "Alternate 1985 (1985A)", "Return to 1955"},
    "green": {"The Old West, 1885", "The return home"},
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
        self.assertEqual(len(scenes), 10)
        self.assertEqual({scene["id"] for scene in scenes}, set(range(1, 11)))

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
        # Marty's story starts in 1985, jumps back to 1955, forward to 2015, back
        # to 1985A and 1955, then to 1885, then home — narrative order is not
        # chronologically sorted, which is exactly the time-travel signal.
        self.assertNotEqual(times, sorted(times))
        self.assertTrue(min(times).startswith("1885-09-02"))
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

    def test_creates_a_time_travel_entry_for_every_deleorean_jump(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        self.assertIsNotNone(project_dir)
        entries = sourcebook_list_entries()
        tt_entries = {
            entry["name"]: entry
            for entry in entries
            if entry["category"] == "Time Travel"
        }
        # One entry per DeLorean jump across the trilogy.  These drive the
        # Convergence Map timeline panel: every entry becomes a jump arrow, and
        # every branch-creating entry draws the branch's spawn arc.
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
            self.assertEqual(entry["timeline_id"], expected["timeline_id"])

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
        self.assertEqual(set(branch_scenes.values()), branch_lanes)
        # Each branch lane holds at least one scene.
        for lane in branch_lanes:
            self.assertIn(lane, branch_scenes.values())

    def test_scenes_reference_their_departure_time_travel_entries(self) -> None:
        project_dir = seed_back_to_the_future_trilogy()
        scenes = list_scenes(project_dir)
        by_summary = {scene["summary"]: scene for scene in scenes}
        # Each jump is referenced only from its departure scene (the scene from
        # which the DeLorean leaves), so the timeline panel anchors the arrow's
        # departure to a real scene dot on the source timeline.
        self.assertIn(
            "1985 -> 2015", by_summary["Twin Pines Mall"]["sourcebook_entry_ids"]
        )
        self.assertIn(
            "1985 -> 1955", by_summary["The Libyan attack"]["sourcebook_entry_ids"]
        )
        self.assertIn(
            "1985 -> 1885", by_summary["The Libyan attack"]["sourcebook_entry_ids"]
        )
        self.assertIn(
            "2015 -> 1985A", by_summary["Hill Valley 2015"]["sourcebook_entry_ids"]
        )
        self.assertIn(
            "1985A -> 1955",
            by_summary["Alternate 1985 (1985A)"]["sourcebook_entry_ids"],
        )
        # Arrival scenes do not reference the jump: the timeline panel finds the
        # destination scene by its epoch on the branch timeline.
        self.assertEqual(by_summary["Return to 1955"]["sourcebook_entry_ids"], [])
        self.assertEqual(by_summary["The Old West, 1885"]["sourcebook_entry_ids"], [])

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
        by_id = {scene["id"]: scene for scene in scenes}
        # Causal chain: each scene is caused by its predecessor (except the first).
        for scene_id, scene in by_id.items():
            self.assertEqual(scene["causes"], [] if scene_id == 1 else [scene_id - 1])
        # Characters are preserved per scene, including the alternate-1985 villain.
        alt = next(s for s in scenes if s["summary"] == "Alternate 1985 (1985A)")
        self.assertEqual(
            alt["active_characters"], ["Marty McFly", "Doc Brown", "Biff Tannen"]
        )
        dance = next(s for s in scenes if s["summary"] == "Enchantment Under the Sea")
        self.assertIn("Lorraine Baines", dance["active_characters"])

    def test_seed_creates_exactly_the_shared_scene_set(self) -> None:
        # The seed is the single source of truth: the test asserts the seed's own
        # data, and the number of scenes it creates matches that data.
        self.assertEqual(len(SCENES), 10)
        self.assertGreaterEqual(len(CHARACTERS), 3)
        project_dir = get_active_project_dir()
        if project_dir is None:
            project_dir = seed_back_to_the_future_trilogy()
        self.assertEqual(len(list_scenes(project_dir)), len(SCENES))
