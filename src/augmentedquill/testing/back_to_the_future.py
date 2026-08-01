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

Canonical in-universe dates are taken from the films: Marty arrives in 1955 on
November 5, 1955 (the night Doc invents the flux capacitor); the courthouse
clock is struck on November 12, 1955 at 10:04 PM; Marty and Doc visit October
21, 2015; Doc is stranded in the Old West of 1885.

Every time jump opens a new timeline, so only the trilogy's "present" stays on
on ``main``.  The trip to 1955 (Part I) gets ``branch:1985 -> 1955``, the
future gets ``branch:1985 -> 2015``, the alternate 1985 and the fixing trip get
``branch:2015 -> 1985A`` and ``branch:1985A -> 1955``, and the Old West gets
``branch:1985 -> 1885``.

Each DeLorean jump is also stored as a ``Time Travel`` sourcebook entry so the
Convergence Map can draw the branch spawn arcs and jump arrows on its left-hand
timeline panel — the same fields a user would fill in for their own time-travel
story.

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
# the branch; sourcebook_entry_ids reference the jumps that depart from or land
# on the scene so the arrows anchor to real scene dots.
SCENES: list[tuple[str, str, str, list[str], list[str], list[int], str, list[str]]] = [
    (
        "Twin Pines Mall",
        "1985-10-26T01:15:00Z",
        "main",
        ["Marty McFly", "Doc Brown"],
        [],
        [],
        "blue",
        ["1985 -> 2015"],
    ),
    (
        "The Libyan attack",
        "1985-10-26T01:35:00Z",
        "main",
        ["Marty McFly", "Doc Brown"],
        [],
        [1],
        "blue",
        ["1985 -> 1955", "1985 -> 1885"],
    ),
    (
        "Arrival in 1955",
        "1955-11-05T22:04:00Z",
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
        [3],
        "blue",
        [],
    ),
    (
        "Lightning sends Marty home",
        "1955-11-12T22:04:00Z",
        "branch:1985 -> 1955",
        ["Marty McFly", "Doc Brown"],
        [],
        [4],
        "blue",
        [],
    ),
    (
        "Hill Valley 2015",
        "2015-10-21T18:00:00Z",
        "branch:1985 -> 2015",
        ["Marty McFly", "Doc Brown"],
        ["Jennifer Parker"],
        [5],
        "orange",
        ["2015 -> 1985A"],
    ),
    (
        "Alternate 1985 (1985A)",
        "1985-10-27T09:00:00Z",
        "branch:2015 -> 1985A",
        ["Marty McFly", "Doc Brown", "Biff Tannen"],
        [],
        [6],
        "orange",
        ["1985A -> 1955"],
    ),
    (
        "Return to 1955",
        "1955-11-12T21:30:00Z",
        "branch:1985A -> 1955",
        ["Marty McFly", "Doc Brown", "Biff Tannen"],
        [],
        [7],
        "orange",
        [],
    ),
    (
        "The Old West, 1885",
        "1885-09-02T12:00:00Z",
        "branch:1985 -> 1885",
        ["Marty McFly", "Doc Brown", "Clara Clayton"],
        [],
        [8],
        "green",
        [],
    ),
    (
        "The return home",
        "1985-10-27T12:00:00Z",
        "main",
        ["Marty McFly", "Doc Brown", "Clara Clayton"],
        ["Jennifer Parker"],
        [9],
        "green",
        [],
    ),
]

# (name, description, origin_date, destination_datetime, creates_new_timeline,
#  timeline_id) — one entry per DeLorean jump.  Every jump opens a new branch
# named ``branch:<name>``; the scenes that land on it use that id (see SCENES)
# so the Convergence Map timeline panel draws a spawn arc + arrow per jump.
TIME_TRAVELS: list[tuple[str, str, str, str, bool, str]] = [
    (
        "1985 -> 1955",
        (
            "Marty's first jump from 1985 to 1955 after the Libyan attack at "
            "Twin Pines Mall."
        ),
        "1985-10-26T01:35:00Z",
        "1955-11-05T22:04:00Z",
        True,
        "main",
    ),
    (
        "1985 -> 2015",
        "Marty, Doc and Jennifer travel from 1985 to the Hill Valley of 2015.",
        "1985-10-26T01:15:00Z",
        "2015-10-21T18:00:00Z",
        True,
        "main",
    ),
    (
        "2015 -> 1985A",
        "Returning from 2015, the trio lands in Biff's alternate 1985.",
        "2015-10-21T18:00:00Z",
        "1985-10-27T09:00:00Z",
        True,
        "branch:1985 -> 2015",
    ),
    (
        "1985A -> 1955",
        (
            "Marty travels from the alternate 1985 to 1955 to retrieve the "
            "stolen sports almanac."
        ),
        "1985-10-27T09:00:00Z",
        "1955-11-12T21:30:00Z",
        True,
        "branch:2015 -> 1985A",
    ),
    (
        "1985 -> 1885",
        (
            "Doc is stranded in the Old West of 1885 after a lightning strike "
            "sends the DeLorean back in time."
        ),
        "1985-10-26T01:35:00Z",
        "1885-09-02T12:00:00Z",
        True,
        "main",
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
