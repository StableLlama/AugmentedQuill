# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Single source of truth for the Back to the Future demo story.

The trilogy is defined once here and created through the real project, scene
and sourcebook services.  Both the backend test
(``tests/unit/services/test_scene_time_travel.py``) and the documentation
screenshot pipeline (``docs-screenshots.config.ts`` runs this module as
``python -m augmentedquill.testing.back_to_the_future``) use this one code
path, so the generated Convergence Map screenshot doubles as a visual check
that this creation code works.

Canonical in-universe dates are taken from the films and the trilogy's 14
time-travel events: Einstein's test run and the Libyan attack on October 26,
1985; Marty arrives in 1955 on November 5, 1955 and the courthouse clock is
struck on November 12, 1955 at 10:04 PM; Marty and Doc visit October 21, 2015;
Old Biff steals the DeLorean and hands the almanac to his 1955 self; the trio
returns to Biff's dystopian 1985 (1985A) and goes back to 1955 to burn the
almanac; Doc is struck by lightning and stranded in the Old West of 1885;
Marty follows, and the story ends with the Time Train arriving in 1985.

Timelines are the app's own (not the films' fan-canon numbering): ``main`` is
ONLY the trilogy's ORIGINAL 1985 (Timeline 1 — Einstein's test run and the
Libyan attack).  Once Marty changes the past, every later scene lives on an
altered line.

UNIVERSAL RULE: a time travel to the PAST always opens a new branch; a time
travel to the FUTURE stays on the same line.  Past-travels here (arrival is
earlier than departure): Marty's 1985 -> 1955, Old Biff's 2015 -> 1955, Doc's
2015 -> 1985 return to warn, the 2015 -> 1985-A trip to the alternate 1985, the
1985-A -> 1955 trip that fixes it, Doc's 1955 -> 1885 and Marty's 1955 -> 1885.
Future-travels (arrival is later than departure, so they stay on their line):
Einstein's test run, the returns from 1955 / 1885 to 1985, and the trips to
2015.

Each branch starts off a timeline that exists at the moment it is created:
Old Biff's 1955 and the restored 1955 branch off the first 1955 line, the
alternate 1985 branches off Old Biff's 1955, Marty's 1885 opens a second Old
West line off Doc's 1885, and the first 1955 and Doc's 1885 branch off
``main`` (their direct departure timeline — 2015, 1985-A — does not exist at
the branch's creation moment, so the parent falls back to the timeline that
does exist).  This keeps the Convergence Map's directory-tree lanes connected
(no floating spawns).

Each time-travel event is also stored as a ``Time Travel`` sourcebook entry so
the Convergence Map can draw the branch spawn arcs and jump arrows on its
left-hand timeline panel — the same fields a user would fill in for their own
time-travel story.

Each movie also shares one ``color_tag`` (blue for Part I, orange for Part II,
green for Part III) so a chronologically sorted view makes it obvious at a
glance which movie a scene belongs to.
"""

from __future__ import annotations

from pathlib import Path

from augmentedquill.models.scene import SceneCreateRequest
from augmentedquill.services.projects.projects import (
    create_new_book,
    create_new_chapter,
    create_project,
    get_active_project_dir,
)
from augmentedquill.services.scenes.scene_service import create_scene
from augmentedquill.services.sourcebook.sourcebook_helpers import (
    sourcebook_create_entry,
)

STORY_TITLE = "Back to the Future"

BOOKS: tuple[str, str, str] = (
    "Back to the Future",
    "Back to the Future Part II",
    "Back to the Future Part III",
)
CHAPTERS: tuple[str, str, str] = ("The DeLorean", "The Future", "The Old West")

# (summary, scene_time, timeline_id, active_characters, passive_characters,
#  causes, color_tag, sourcebook_entry_ids)
# Scene ids are assigned 1..N in order; causes reference prior ids.  Colors are
# per movie so a chronologically sorted view groups scenes by which movie they
# belong to: blue = Part I, orange = Part II, green = Part III.
# Branch scenes name their timeline ``branch:<jump entry name>`` so the
# Convergence Map can draw a spawn arc from the Time Travel entry that creates
# the branch; sourcebook_entry_ids reference the jumps that depart from the
# scene so the arrows anchor to real scene dots.
SCENES: list[tuple[str, str, str, list[str], list[str], list[int], str, list[str]]] = [
    (
        "Einstein's Test Run",
        "1985-10-26T01:18:00Z",
        "main",
        ["Doc Brown"],
        [],
        [],
        "blue",
        ["Einstein's Test Run"],
    ),
    (
        "The Libyan Attack",
        "1985-10-26T01:35:00Z",
        "main",
        ["Marty McFly", "Doc Brown"],
        [],
        [1],
        "blue",
        ["1985 -> 1955"],
    ),
    (
        "Trip to the Future (2015)",
        "1985-10-26T10:29:00Z",
        "branch:1985 -> 1955",
        ["Doc Brown", "Marty McFly"],
        ["Jennifer Parker"],
        [2],
        "blue",
        ["1985 -> 2015 (the trio)"],
    ),
    (
        "Arrival in 1955",
        "1955-11-05T06:00:00Z",
        "branch:1985 -> 1955",
        ["Marty McFly", "Doc Brown"],
        [],
        [2],
        "blue",
        [],
    ),
    (
        "Enchantment Under the Sea",
        "1955-11-12T21:00:00Z",
        "branch:1985 -> 1955",
        ["Marty McFly", "George McFly", "Lorraine Baines"],
        [],
        [4],
        "blue",
        [],
    ),
    (
        "Lightning Sends Marty Home",
        "1955-11-12T22:04:00Z",
        "branch:1985 -> 1955",
        ["Marty McFly", "Doc Brown"],
        [],
        [5],
        "blue",
        ["1955 -> 1985"],
    ),
    (
        "Hill Valley 2015",
        "2015-10-21T16:29:00Z",
        "branch:1985 -> 1955",
        ["Marty McFly", "Doc Brown"],
        ["Jennifer Parker"],
        [3],
        "orange",
        ["2015 -> 1985"],
    ),
    (
        "Old Biff Steals the DeLorean",
        "2015-10-21T18:00:00Z",
        "branch:1985 -> 1955",
        ["Biff Tannen"],
        [],
        [7],
        "orange",
        ["2015 -> 1955"],
    ),
    (
        "The Return to Hell Valley",
        "2015-10-21T19:28:00Z",
        "branch:2015 -> 1955",
        ["Doc Brown", "Marty McFly"],
        [],
        [8],
        "orange",
        ["2015 -> 1985A"],
    ),
    (
        "Alternate 1985 (1985A)",
        "1985-10-26T09:00:00Z",
        "branch:2015 -> 1985A",
        ["Marty McFly", "Doc Brown", "Biff Tannen"],
        [],
        [9],
        "orange",
        [],
    ),
    (
        "Go Back to 1955",
        "1985-10-27T02:42:00Z",
        "branch:2015 -> 1985A",
        ["Marty McFly", "Doc Brown"],
        [],
        [10],
        "orange",
        ["1985A -> 1955"],
    ),
    (
        "Old Biff Gives the Almanac",
        "1955-11-12T14:00:00Z",
        "branch:2015 -> 1955",
        ["Biff Tannen"],
        [],
        [8],
        "orange",
        [],
    ),
    (
        "Return to 1955",
        "1955-11-12T06:00:00Z",
        "branch:1985A -> 1955",
        ["Marty McFly", "Doc Brown"],
        [],
        [11],
        "orange",
        [],
    ),
    (
        "Doc Struck by Lightning",
        "1955-11-12T21:44:00Z",
        "branch:1985A -> 1955",
        ["Doc Brown"],
        [],
        [13],
        "orange",
        ["1955 -> 1885"],
    ),
    (
        "Marty Leaves for the Old West",
        "1955-11-16T10:00:00Z",
        "branch:1985A -> 1955",
        ["Marty McFly"],
        [],
        [14],
        "green",
        ["1955 -> 1885 (Marty)"],
    ),
    (
        "Doc Arrives in 1885",
        "1885-01-01T00:00:00Z",
        "branch:1955 -> 1885",
        ["Doc Brown"],
        [],
        [14],
        "green",
        [],
    ),
    (
        "Marty Arrives in the Old West",
        "1885-09-02T08:00:00Z",
        "branch:1955 -> 1885 (Marty)",
        ["Marty McFly", "Doc Brown", "Clara Clayton"],
        [],
        [15],
        "green",
        [],
    ),
    (
        "Marty Departs the Old West",
        "1885-09-07T09:00:00Z",
        "branch:1955 -> 1885 (Marty)",
        ["Marty McFly", "Doc Brown", "Clara Clayton"],
        [],
        [17],
        "green",
        ["1885 -> 1985"],
    ),
    (
        "Doc Builds the Time Train",
        "1885-09-08T12:00:00Z",
        "branch:1955 -> 1885 (Marty)",
        ["Doc Brown", "Clara Clayton"],
        [],
        [16],
        "green",
        ["1885 -> 1985 (the Time Train)"],
    ),
    (
        "The Return Home",
        "1985-10-27T11:00:00Z",
        "branch:1955 -> 1885 (Marty)",
        ["Marty McFly", "Doc Brown", "Clara Clayton"],
        ["Jennifer Parker"],
        [18],
        "green",
        [],
    ),
    (
        "The Time Train Arrives",
        "1985-10-27T12:00:00Z",
        "branch:1955 -> 1885 (Marty)",
        ["Doc Brown", "Clara Clayton"],
        ["Jennifer Parker"],
        [19],
        "green",
        ["The Time Train Departs"],
    ),
    (
        "Old Biff Returns to 2015",
        "1955-11-12T18:38:00Z",
        "branch:2015 -> 1955",
        ["Biff Tannen"],
        [],
        [12],
        "orange",
        ["1955 -> 2015"],
    ),
]

# (name, description, origin_date, destination_datetime, creates_new_timeline,
#  timeline_id) — one entry per time-travel event.  A branch-creating jump opens
# a new branch named ``branch:<name>``; the scenes that land on it use that id
# (see SCENES) so the Convergence Map timeline panel draws a spawn arc + arrow
# per jump.  ``timeline_id`` is the timeline the branch starts off (its parent):
# per the Convergence Map's "common ancestor" rule a branch must start off a
# timeline that exists at the moment it is created, so when the direct departure
# timeline does not exist at that time (2015 / 1985A do not exist in 1955) the
# parent falls back to ``main``.
TIME_TRAVELS: list[tuple[str, str, str, str | None, bool, str]] = [
    (
        "Einstein's Test Run",
        (
            "Doc proves time travel works when the DeLorean carries Einstein "
            "one minute into the future."
        ),
        "1985-10-26T01:18:00Z",
        "1985-10-26T01:19:00Z",
        False,
        "main",
    ),
    (
        "1985 -> 1955",
        (
            "Marty's first jump from 1985 to 1955 after the Libyan attack at "
            "Twin Pines Mall."
        ),
        "1985-10-26T01:35:00Z",
        "1955-11-05T06:00:00Z",
        True,
        "main",
    ),
    (
        "1955 -> 1985",
        (
            "Marty rides the lightning back to an improved 1985 where George "
            "is a writer and Doc survives."
        ),
        "1955-11-12T22:04:00Z",
        "1985-10-26T01:24:00Z",
        False,
        "branch:1985 -> 1955",
    ),
    (
        "2015 -> 1985",
        (
            "Doc returns from 2015 to warn Marty and Jennifer about their "
            "future children.  This is a trip to the PAST (1985 is earlier "
            "than 2015), so per the universal rule it opens a new branch."
        ),
        "2015-10-21T16:30:00Z",
        "1985-10-26T10:28:00Z",
        True,
        "branch:1985 -> 1955",
    ),
    (
        "1985 -> 2015 (the trio)",
        (
            "Doc, Marty and Jennifer travel to 2015 to stop Marty Jr.'s "
            "arrest.  This is the trilogy's one trip to the future — it departs "
            "from the altered 1985 (Trip to the Future (2015)) and stays on the "
            "same line."
        ),
        "1985-10-26T10:29:00Z",
        "2015-10-21T16:29:00Z",
        False,
        "branch:1985 -> 1955",
    ),
    (
        "2015 -> 1955",
        (
            "Old Biff steals the DeLorean and gives the sports almanac to his "
            "1955 self, creating a divergent 1955."
        ),
        "2015-10-21T18:00:00Z",
        "1955-11-12T14:00:00Z",
        True,
        "branch:1985 -> 1955",
    ),
    (
        "1955 -> 2015",
        (
            "Old Biff returns to 2015, where he fades out of existence as the "
            "timeline changes around him."
        ),
        "1955-11-12T18:38:00Z",
        "2015-10-21T18:38:00Z",
        False,
        "branch:2015 -> 1955",
    ),
    (
        "2015 -> 1985A",
        (
            "Doc, Marty and Jennifer return from 2015 and land in Biff's "
            "dystopian alternate 1985.  This is a trip to the PAST, so it "
            "opens a new branch."
        ),
        "2015-10-21T19:28:00Z",
        "1985-10-26T09:00:00Z",
        True,
        "branch:2015 -> 1955",
    ),
    (
        "1985A -> 1955",
        (
            "Doc and Marty travel from the alternate 1985 back to 1955 to "
            "burn the stolen sports almanac."
        ),
        "1985-10-27T02:42:00Z",
        "1955-11-12T06:00:00Z",
        True,
        "branch:1985 -> 1955",
    ),
    (
        "1955 -> 1885",
        (
            "Doc is struck by lightning in 1955 and the DeLorean carries him "
            "to the Old West of 1885."
        ),
        "1955-11-12T21:44:00Z",
        "1885-01-01T00:00:00Z",
        True,
        "main",
    ),
    (
        "1955 -> 1885 (Marty)",
        (
            "Marty travels to 1885 after finding Doc's gravestone, to stop "
            "Doc from being murdered by Buford Tannen.  His arrival opens a "
            "second Old West line off Doc's 1885."
        ),
        "1955-11-16T10:00:00Z",
        "1885-09-02T08:00:00Z",
        True,
        "branch:1955 -> 1885",
    ),
    (
        "1885 -> 1985",
        (
            "Marty pushes the locomotive to 88 mph and returns to 1985, "
            "landing on the train tracks.  This is a trip to the FUTURE, so it "
            "stays on the Old West line he was on — it does not open a branch."
        ),
        "1885-09-07T09:00:00Z",
        "1985-10-27T11:00:00Z",
        False,
        "branch:1955 -> 1885 (Marty)",
    ),
    (
        "1885 -> 1985 (the Time Train)",
        (
            "Doc, Clara and their children arrive in 1985 aboard the "
            "steam-powered Time Train — a future travel, so it stays on the "
            "Old West line."
        ),
        "1885-09-08T12:00:00Z",
        "1985-10-27T12:00:00Z",
        False,
        "branch:1955 -> 1885 (Marty)",
    ),
    (
        "The Time Train Departs",
        (
            "The Time Train lifts off and travels to parts unknown — 'already "
            "been there'."
        ),
        "1985-10-27T12:00:00Z",
        None,
        False,
        "branch:1955 -> 1885 (Marty)",
    ),
]

# (name, description, origin_date, synonyms) — the characters whose scenes draw
# Convergence Map lanes (Character category).
CHARACTERS: list[tuple[str, str, str, list[str]]] = [
    (
        "Marty McFly",
        (
            "A 17-year-old skateboarder whose adventures with Doc Brown rewrite "
            "Hill Valley history. He travels to 1955, 2015 and 1885."
        ),
        "1968-06-12",
        ["Marty"],
    ),
    (
        "Doc Brown",
        (
            "The eccentric scientist who built the DeLorean time machine and "
            "coined the phrase \"where we're going, we don't need roads\"."
        ),
        "1920-04-03",
        ["Dr. Emmett Brown", "Doc"],
    ),
    (
        "Biff Tannen",
        (
            "The Hill Valley bully. In the alternate 1985 he uses the stolen "
            "sports almanac to build a corrupt empire."
        ),
        "1938-02-27",
        ["Biff"],
    ),
    (
        "George McFly",
        (
            "Marty's shy father, who only finds his courage at the Enchantment "
            "Under the Sea dance."
        ),
        "1938-04-01",
        ["George"],
    ),
    (
        "Lorraine Baines",
        (
            "Marty's mother, who falls in love with George after he stands up "
            "to Biff."
        ),
        "1938-03-10",
        ["Lorraine"],
    ),
    (
        "Clara Clayton",
        (
            "A schoolteacher who arrives in 1885 and becomes Doc Brown's wife "
            "in the Old West."
        ),
        "1861-05-18",
        ["Clara"],
    ),
    (
        "Jennifer Parker",
        (
            "Marty's girlfriend, who comes along (unintentionally) on the trip "
            "to 2015."
        ),
        "1968-10-29",
        ["Jennifer"],
    ),
]


def seed_back_to_the_future_trilogy() -> Path:
    """Create the trilogy through the real services; returns the project dir."""
    ok, message = create_project(STORY_TITLE, project_type="series")
    if not ok:
        raise RuntimeError(f"could not create project: {message}")
    project_dir = get_active_project_dir()
    if project_dir is None:
        raise RuntimeError("no active project after creation")

    book_ids = [create_new_book(title) for title in BOOKS]
    if len(set(book_ids)) != len(BOOKS):
        raise RuntimeError("expected one book per movie")

    for book_id, chapter in zip(book_ids, CHAPTERS):
        create_new_chapter(title=chapter, book_id=book_id)

    for summary, iso, timeline, active, passive, causes, color, entry_ids in SCENES:
        create_scene(
            project_dir,
            SceneCreateRequest(
                summary=summary,
                active_characters=active,
                passive_characters=passive,
                location="Hill Valley",
                scene_time=iso,
                timeline_id=timeline,
                causes=causes,
                color_tag=color,
                sourcebook_entry_ids=entry_ids,
            ),
        )

    for name, description, origin, synonyms in CHARACTERS:
        result = sourcebook_create_entry(
            name=name,
            description=description,
            category="Character",
            synonyms=synonyms,
            origin_date=origin,
            timeline_id="main",
        )
        if "error" in result:
            raise RuntimeError(
                f"could not create sourcebook entry {name}: {result['error']}"
            )

    # Every DeLorean jump is a Time Travel sourcebook entry: the Convergence Map
    # timeline panel turns each one into a jump arrow and draws a spawn arc for
    # each branch-creating jump.  Branch scenes reference the same names in
    # SCENES so the arrows anchor to real scene dots.
    for (
        name,
        description,
        origin,
        destination,
        creates_branch,
        timeline,
    ) in TIME_TRAVELS:
        result = sourcebook_create_entry(
            name=name,
            description=description,
            category="Time Travel",
            origin_date=origin,
            destination_datetime=destination,
            creates_new_timeline=creates_branch,
            timeline_id=timeline,
        )
        if "error" in result:
            raise RuntimeError(
                f"could not create time travel entry {name}: {result['error']}"
            )

    return project_dir


def main() -> None:
    project_dir = seed_back_to_the_future_trilogy()
    print(f"Seeded Back to the Future project at {project_dir}")


if __name__ == "__main__":
    main()
