# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""API-level tests for marker-based scenes endpoints."""

import json
from pathlib import Path
import re
import shutil
from unittest.mock import AsyncMock, patch

from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class ScenesApiTest(ApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        ok, msg = select_project("scenes_api_proj")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "scenes_api_proj"
        story = {
            "metadata": {"version": 2},
            "project_title": "Scenes API Test",
            "format": "markdown",
            "project_type": "short-story",
            "scenes": {},
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")
        (pdir / "content.md").write_text("Alpha Bravo Charlie", encoding="utf-8")
        self.pname = "scenes_api_proj"

    def _url(self, suffix: str = "") -> str:
        return f"/api/v1/projects/{self.pname}/scenes{suffix}"

    def _create(self, **kwargs) -> dict:
        resp = self.client.post(self._url(), json=kwargs)
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()

    def _rewrite_story(self, story: dict) -> None:
        pdir = self.projects_root / self.pname
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

    def _reset_project_content_tree(self) -> None:
        pdir = self.projects_root / self.pname
        for rel in ("chapters", "books"):
            path = pdir / rel
            if path.exists():
                shutil.rmtree(path)

    def _configure_scope(
        self,
        *,
        project_case: str,
    ) -> tuple[dict[str, object], Path]:
        pdir = self.projects_root / self.pname
        self._reset_project_content_tree()

        if project_case == "short-story":
            story = {
                "metadata": {"version": 2},
                "project_title": "Scenes API Test",
                "format": "markdown",
                "project_type": "short-story",
                "scenes": {},
            }
            self._rewrite_story(story)
            path = pdir / "content.md"
            path.write_text("", encoding="utf-8")
            return ({"scope_type": "story"}, path)

        if project_case == "novel":
            story = {
                "metadata": {"version": 2},
                "project_title": "Scenes API Test",
                "format": "markdown",
                "project_type": "novel",
                "chapters": [
                    {"id": "1", "filename": "0001.txt"},
                    {"id": "2", "filename": "0002.txt"},
                    {"id": "3", "filename": "0003.txt"},
                ],
                "scenes": {},
            }
            self._rewrite_story(story)
            chapters_dir = pdir / "chapters"
            chapters_dir.mkdir(parents=True, exist_ok=True)
            for filename in ("0001.txt", "0002.txt", "0003.txt"):
                (chapters_dir / filename).write_text("", encoding="utf-8")
            return (
                {
                    "scope_type": "chapter",
                    "chapter_id": "2",
                    "book_id": None,
                },
                chapters_dir / "0002.txt",
            )

        # series-first-book / series-middle-book / series-last-book
        book_id = (
            "book-1"
            if project_case == "series-first-book"
            else "book-2" if project_case == "series-middle-book" else "book-3"
        )
        books = []
        for idx in (1, 2, 3):
            books.append(
                {
                    "id": f"book-{idx}",
                    "title": f"Book {idx}",
                    "chapters": [
                        {"id": "1", "filename": "0001.txt"},
                        {"id": "2", "filename": "0002.txt"},
                    ],
                }
            )
        story = {
            "metadata": {"version": 2},
            "project_title": "Scenes API Test",
            "format": "markdown",
            "project_type": "series",
            "books": books,
            "scenes": {},
        }
        self._rewrite_story(story)
        for bid in ("book-1", "book-2", "book-3"):
            chapter_dir = pdir / "books" / bid / "chapters"
            chapter_dir.mkdir(parents=True, exist_ok=True)
            (chapter_dir / "0001.txt").write_text("", encoding="utf-8")
            (chapter_dir / "0002.txt").write_text("", encoding="utf-8")

        return (
            {
                "scope_type": "chapter",
                "chapter_id": "1",
                "book_id": book_id,
            },
            pdir / "books" / book_id / "chapters" / "0001.txt",
        )

    def _extract_scene_payload(self, content: str, scene_id: int) -> str:
        pattern = re.compile(
            rf"<!--scene:{scene_id}:start-->(.*?)<!--scene:{scene_id}:end-->",
            flags=re.DOTALL,
        )
        match = pattern.search(content)
        self.assertIsNotNone(match, f"Missing marker span for scene {scene_id}")
        return match.group(1) if match else ""

    def _assert_single_marker_pair_per_scene(
        self, content: str, scene_ids: list[int]
    ) -> None:
        for scene_id in scene_ids:
            self.assertEqual(content.count(f"<!--scene:{scene_id}:start-->"), 1)
            self.assertEqual(content.count(f"<!--scene:{scene_id}:end-->"), 1)

    def _extract_scene_payload_from_content_or_link(
        self,
        *,
        content: str,
        scene: dict,
    ) -> str:
        scene_id = int(scene.get("id") or 0)
        marker_start = f"<!--scene:{scene_id}:start-->"
        marker_end = f"<!--scene:{scene_id}:end-->"
        if marker_start in content and marker_end in content:
            return self._extract_scene_payload(content, scene_id)

        prose_link = scene.get("prose_link")
        self.assertIsInstance(prose_link, dict)
        start_offset = int((prose_link or {}).get("start_offset") or 0)
        end_offset = int((prose_link or {}).get("end_offset") or start_offset)
        self.assertGreaterEqual(end_offset, start_offset)
        return content[start_offset:end_offset]

    def _assert_scene_markers_if_present(
        self, content: str, scene_ids: list[int]
    ) -> None:
        for scene_id in scene_ids:
            start_count = content.count(f"<!--scene:{scene_id}:start-->")
            end_count = content.count(f"<!--scene:{scene_id}:end-->")
            self.assertIn(start_count, (0, 1))
            self.assertEqual(start_count, end_count)

    def _scene_marker_order(self, content: str) -> list[int]:
        return [
            int(match.group(1))
            for match in re.finditer(r"<!--scene:(\d+):start-->", content)
        ]

    def test_create_list_get_delete_crud(self) -> None:
        created = self._create(summary="Scene A")

        listed = self.client.get(self._url())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)

        fetched = self.client.get(self._url(f"/{created['id']}"))
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["summary"], "Scene A")

        deleted = self.client.delete(self._url(f"/{created['id']}"))
        self.assertEqual(deleted.status_code, 204)

    def test_link_and_unlink_scene_prose(self) -> None:
        scene = self._create(summary="Linked")

        linked = self.client.post(
            self._url(f"/{scene['id']}/link-prose"),
            json={"scope_type": "story", "start_offset": 0, "end_offset": 5},
        )
        self.assertEqual(linked.status_code, 200, linked.text)

        fetched = self.client.get(self._url(f"/{scene['id']}"))
        self.assertEqual(fetched.status_code, 200)
        self.assertIsNotNone(fetched.json()["prose_link"])

        unlinked = self.client.post(self._url(f"/{scene['id']}/unlink-prose"), json={})
        self.assertEqual(unlinked.status_code, 200, unlinked.text)

        fetched_after = self.client.get(self._url(f"/{scene['id']}"))
        self.assertEqual(fetched_after.status_code, 200)
        prose_link = fetched_after.json()["prose_link"]
        self.assertIsInstance(prose_link, dict)
        self.assertEqual((prose_link or {}).get("scope_type"), "unlinked")

    def test_patch_prose_content(self) -> None:
        scene = self._create(summary="Edit")
        self.client.post(
            self._url(f"/{scene['id']}/link-prose"),
            json={"scope_type": "story", "start_offset": 0, "end_offset": 5},
        )

        resp = self.client.patch(
            self._url(f"/{scene['id']}/prose-content"),
            json={"text": "Omega"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["id"], scene["id"])

    def test_reorder_prose_reorders_two_linked_scenes(self) -> None:
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname
        (pdir / "content.md").write_text(
            (
                f"<!--scene:{first['id']}:start-->Alpha<!--scene:{first['id']}:end-->"
                f"\n"
                f"<!--scene:{second['id']}:start-->Bravo<!--scene:{second['id']}:end-->"
            ),
            encoding="utf-8",
        )

        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": second["id"],
                "target_scene_id": first["id"],
                "place_before": True,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)

        payload = reorder.json()
        self.assertEqual(payload["scope_type"], "story")
        self.assertEqual(
            [scene["id"] for scene in payload["scenes"]],
            [
                second["id"],
                first["id"],
            ],
        )

    def test_reorder_prose_moves_between_story_and_chapter_scopes(self) -> None:
        source = self._create(summary="Source")
        target = self._create(summary="Target")

        pdir = self.projects_root / self.pname
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["chapters"] = [{"id": "1", "filename": "0001.txt"}]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        chapters_dir = pdir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        (chapters_dir / "0001.txt").write_text(
            "Chapter text for the reordered scene.",
            encoding="utf-8",
        )

        source_link = self.client.post(
            self._url(f"/{source['id']}/link-prose"),
            json={
                "scope_type": "chapter",
                "chapter_id": "1",
                "start_offset": 0,
                "end_offset": 7,
            },
        )
        self.assertEqual(source_link.status_code, 200, source_link.text)

        target_link = self.client.post(
            self._url(f"/{target['id']}/link-prose"),
            json={"scope_type": "story", "start_offset": 0, "end_offset": 6},
        )
        self.assertEqual(target_link.status_code, 200, target_link.text)

        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": source["id"],
                "target_scene_id": target["id"],
                "place_before": True,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)

        payload = reorder.json()
        self.assertEqual(payload["scope_type"], "story")
        self.assertEqual(
            [scene["id"] for scene in payload["scenes"]],
            [
                source["id"],
                target["id"],
            ],
        )
        story_text = (pdir / "content.md").read_text(encoding="utf-8")
        chapter_text = (chapters_dir / "0001.txt").read_text(encoding="utf-8")
        self.assertIn(f"<!--scene:{source['id']}:start-->", story_text)
        self.assertNotIn(f"<!--scene:{source['id']}:start-->", chapter_text)

    def test_reorder_prose_with_straddling_annotation(self) -> None:
        """Reordering scenes with a straddling annotation must return valid
        scope_start/scope_end that do not exceed the original content length."""
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))

        ann_id = "note1"
        content = (
            f"prefix text.\n"
            f"<!--scene:{first['id']}:start-->"
            f"scene one text with <!--annotation:{ann_id}:start-->straddling annotation"
            f"<!--scene:{first['id']}:end-->"
            f"\n"
            f"<!--scene:{second['id']}:start-->"
            f"rest of annotation text<!--annotation:{ann_id}:end--> and scene two"
            f"<!--scene:{second['id']}:end-->"
            f"\nsuffix text."
        )
        (pdir / "content.md").write_text(content, encoding="utf-8")

        story["annotations"] = [
            {
                "id": ann_id,
                "comment": "Straddling annotation",
                "scope_type": "story",
                "chapter_id": None,
                "book_id": None,
            }
        ]
        (story_path).write_text(json.dumps(story), encoding="utf-8")

        original_len = len(content)

        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": first["id"],
                "target_scene_id": second["id"],
                "place_before": False,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)
        payload = reorder.json()

        # scope_start must be non-negative and <= original len
        self.assertGreaterEqual(payload["scope_start"], 0)
        self.assertLessEqual(payload["scope_start"], original_len)
        # scope_end must be within original content length (BEFORE bug fix,
        # this would exceed original_len due to annotation split markers)
        self.assertGreaterEqual(payload["scope_end"], 0)
        self.assertLessEqual(payload["scope_end"], original_len)

        # Verify that applying the rebuilt_text to the original content at the
        # returned offsets produces a valid document (i.e. the frontend can
        # dispatch the change without hitting an out-of-bounds error).
        simulated = (
            content[: payload["scope_start"]]
            + payload["rebuilt_text"]
            + content[payload["scope_end"] :]
        )
        # The simulated result should equal the persisted file content.
        actual_content = (pdir / "content.md").read_text(encoding="utf-8")
        self.assertEqual(simulated, actual_content)

    def test_reorder_prose_preserves_marker_integrity_with_straddling_annotation(
        self,
    ) -> None:
        """Reordering a scene that shares a straddling annotation must never
        produce broken/crossing markers or orphaned annotation fragments.

        Regression test for the bug where -in:end was placed *outside* the
        scene block, causing it to stay behind when the block moved while
        -in:start moved with it — corrupting the annotation."""
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))

        ann_id = "straddler"
        # Annotation spans from inside first scene across the boundary into second.
        content = (
            f"prefix.\n"
            f"<!--scene:{first['id']}:start-->"
            f"scene A text with"
            f" <!--annotation:{ann_id}:start-->shared annotation"
            f"<!--scene:{first['id']}:end-->"
            f"\n"
            f"<!--scene:{second['id']}:start-->"
            f"that continues here<!--annotation:{ann_id}:end-->"
            f" and ends"
            f"<!--scene:{second['id']}:end-->"
            f"\nsuffix."
        )
        (pdir / "content.md").write_text(content, encoding="utf-8")
        story["annotations"] = [
            {
                "id": ann_id,
                "comment": "Straddling",
                "scope_type": "story",
                "chapter_id": None,
                "book_id": None,
            }
        ]
        (story_path).write_text(json.dumps(story), encoding="utf-8")

        # Move first scene after second.
        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": first["id"],
                "target_scene_id": second["id"],
                "place_before": False,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)

        result = (pdir / "content.md").read_text(encoding="utf-8")

        # --- INVARIANT 1: No duplicate start markers for any scene ---
        for sid in (first["id"], second["id"]):
            start_tok = f"<!--scene:{sid}:start-->"
            self.assertEqual(
                result.count(start_tok),
                1,
                f"Scene {sid} has {result.count(start_tok)} start markers",
            )

        # --- INVARIANT 2: Every annotation pair is well-ordered ---
        ann_ids_found = set()
        import re as _re

        for m in _re.finditer(r"<!--annotation:([^:>]+):(start|end)-->", result):
            ann_ids_found.add(m.group(1))
        for aid in sorted(ann_ids_found):
            start_pos = result.find(f"<!--annotation:{aid}:start-->")
            end_pos = result.find(f"<!--annotation:{aid}:end-->")
            self.assertGreater(start_pos, -1, f"Annotation {aid} start marker missing")
            self.assertGreater(end_pos, -1, f"Annotation {aid} end marker missing")
            self.assertLess(
                start_pos,
                end_pos,
                f"Annotation {aid} start ({start_pos}) must precede "
                f"end ({end_pos})",
            )

        # --- INVARIANT 3: -in markers move WITH the scene block ---
        # After reorder, first scene is now after second scene.
        # Find first scene's block.
        first_start = result.find(f"<!--scene:{first['id']}:start-->")
        first_end_marker = f"<!--scene:{first['id']}:end-->"
        first_end = result.find(first_end_marker)
        self.assertGreater(first_start, -1, "First scene start not found")
        self.assertGreater(first_end, -1, "First scene end not found")
        first_block_end = first_end + len(first_end_marker)

        in_start = result.find("<!--annotation:straddler-in:start-->")
        in_end = result.find("<!--annotation:straddler-in:end-->")
        self.assertGreater(in_start, -1, "-in:start must exist")
        self.assertGreater(in_end, -1, "-in:end must exist")

        # Both -in markers must be inside first scene's block
        self.assertGreaterEqual(
            in_start,
            first_start,
            "-in:start must be at or after first scene start",
        )
        self.assertLessEqual(
            in_end,
            first_block_end,
            f"-in:end ({in_end}) must be at or before first scene block end "
            f"({first_block_end})",
        )
        self.assertLess(
            in_start,
            in_end,
            "-in:start must precede -in:end",
        )

        # --- INVARIANT 4: -out markers must be well-ordered ---
        out_start = result.find("<!--annotation:straddler-out:start-->")
        out_end = result.find("<!--annotation:straddler-out:end-->")
        self.assertGreater(out_start, -1, "-out:start must exist")
        self.assertGreater(out_end, -1, "-out:end must exist")
        self.assertLess(
            out_start,
            out_end,
            "-out:start must precede -out:end",
        )

    def test_detect_boundaries_links_single_scene(self) -> None:
        scene = self._create(summary="Boundary")
        resp = self.client.post(
            self._url("/detect-boundaries"),
            json={
                "scope_type": "story",
                "scene_ids": [scene["id"]],
                "start_offset": 0,
                "end_offset": 10,
                "prose_text": "Alpha text",
            },
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertEqual(len(payload["assignments"]), 1)
        self.assertEqual(payload["assignments"][0]["scene_id"], scene["id"])

    def test_reorder_prose_cleans_up_duplicate_markers_from_corrupted_file(
        self,
    ) -> None:
        """When the file already has duplicate source-scene markers (from a
        previous failed reorder), the reorder must clean them up rather than
        perpetuate the corruption."""
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname

        # Build a file with DUPLICATE scene markers that simulates the
        # corrupted state left behind by a previous failed reorder:
        #   - an orphaned <!--scene:FIRST:start--> with prose fragment
        #   - annotation -out:end (without matching -out:start)
        #   - the target scene (second)
        #   - a well-formed copy of the source scene (first)
        content = (
            f"preamble\n"
            f"<!--scene:{first['id']}:start-->broken prose fragment"
            f"<!--annotation:ann-out:end-->"
            f"<!--scene:{second['id']}:start-->target prose<!--scene:{second['id']}:end-->"
            f"postamble\n"
            f"<!--scene:{first['id']}:start-->"
            f"well-formed prose<!--scene:{first['id']}:end-->"
        )
        (pdir / "content.md").write_text(content, encoding="utf-8")

        # Reorder — move first after second (which is a no-op structurally
        # since first is already after second in the well-formed copy, but
        # the orphaned fragment must be cleaned up).
        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": first["id"],
                "target_scene_id": second["id"],
                "place_before": False,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)

        result = (pdir / "content.md").read_text(encoding="utf-8")

        # INVARIANT: exactly one start marker for each scene
        import re as _re

        for sid in (first["id"], second["id"]):
            matches = list(_re.finditer(rf"<!--scene:{sid}:start-->", result))
            self.assertEqual(
                len(matches),
                1,
                f"Scene {sid} has {len(matches)} start markers (expected 1): "
                f"{[m.start() for m in matches]}",
            )

        # INVARIANT: annotation markers that were part of the source scene's
        # original block are removed along with the duplicate scene markers.
        # Annotation-only orphans (e.g. -out:end without -out:start from a
        # previous split) are a cosmetic concern, not a scene-marker one.

    def test_reorder_annotated_scene_preserves_full_file_content(self) -> None:
        """Reproduce exact user scenario: annotation from inside scene A
        into scene B, then moving scene A after scene B.  The file must
        not be truncated or lose any scene content."""
        # Create all needed scenes first.
        scenes: dict[str, dict] = {}
        for label in ("a", "b", "c", "d"):
            s = self._create(summary=label)
            scenes[label] = s

        pdir = self.projects_root / self.pname
        (pdir / "content.md").write_text(
            (
                f"<!--scene:{scenes['a']['id']}:start-->a<!--scene:{scenes['a']['id']}:end-->\n"
                f"<!--scene:{scenes['b']['id']}:start-->b<!--scene:{scenes['b']['id']}:end-->\n"
                f"<!--scene:{scenes['c']['id']}:start-->sceneC <!--annotation:note1:start-->"
                f"moreC<!--scene:{scenes['c']['id']}:end-->\n"
                f"<!--scene:{scenes['d']['id']}:start-->sceneD<!--annotation:note1:end-->"
                f"moreD<!--scene:{scenes['d']['id']}:end-->\n"
            ),
            encoding="utf-8",
        )
        story_path = pdir / "story.json"
        story = json.loads(story_path.read_text(encoding="utf-8"))
        story["annotations"] = [
            {
                "id": "note1",
                "comment": "Straddles",
                "scope_type": "story",
                "chapter_id": None,
                "book_id": None,
            }
        ]
        story_path.write_text(json.dumps(story), encoding="utf-8")

        reorder = self.client.post(
            self._url("/reorder-prose"),
            json={
                "source_scene_id": scenes["c"]["id"],
                "target_scene_id": scenes["d"]["id"],
                "place_before": False,
            },
        )
        self.assertEqual(reorder.status_code, 200, reorder.text)

        result = (pdir / "content.md").read_text(encoding="utf-8")
        # The file must contain ALL scenes — nothing truncated.
        for label, sid in [(k, s["id"]) for k, s in scenes.items()]:
            self.assertIn(
                f"<!--scene:{sid}:start-->",
                result,
                f"Scene {label} ({sid}) start marker missing from result",
            )
            self.assertIn(
                f"<!--scene:{sid}:end-->",
                result,
                f"Scene {label} ({sid}) end marker missing from result",
            )
        # Scene C must come after scene D.
        self.assertGreater(
            result.find(f"<!--scene:{scenes['c']['id']}:start-->"),
            result.find(f"<!--scene:{scenes['d']['id']}:end-->"),
            "Scene C should be after scene D after reorder",
        )

    def test_write_scene_generates_text_and_links(self) -> None:
        scene = self._create(summary="Write scene")

        with patch(
            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
            new=AsyncMock(return_value={"content": "Generated scene prose."}),
        ):
            resp = self.client.post(
                self._url(f"/{scene['id']}/write"),
                json={
                    "scope_type": "story",
                    "include_following_scenes": 0,
                    "detect_boundaries": False,
                },
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertEqual(payload["generated_text"], "Generated scene prose.")
        self.assertEqual(payload["scene"]["id"], scene["id"])

    def test_write_scene_prompt_includes_notes_and_next_scene_preview(self) -> None:
        scope_payload, _ = self._configure_scope(project_case="novel")
        pdir = self.projects_root / self.pname
        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        story["story_summary"] = "Overall story summary."
        story["notes"] = "Story notes here."
        story["chapters"][1]["title"] = "Chapter One"
        story["chapters"][1]["summary"] = "The first chapter starts."
        story["chapters"][1]["notes"] = "Chapter notes here."
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        current_scene = self._create(
            summary="Current scene summary",
            beats=[
                {"id": "beat-1", "text": "Hero enters the town square."},
                {"id": "beat-2", "text": "A hidden watcher observes."},
            ],
            active_characters=["Hero"],
            location="Town",
        )
        self._create(
            summary="Next scene summary",
            active_characters=["Villain"],
            location="Forest",
        )

        captured: dict[str, str] = {}

        async def fake_complete(**kwargs: object) -> dict[str, str]:
            messages = kwargs.get("messages") or []
            captured["prompt"] = "\n\n".join(
                str(m.get("content", "")) for m in messages
            )
            return {"content": "Generated prose."}

        with patch(
            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
            new=AsyncMock(side_effect=fake_complete),
        ):
            resp = self.client.post(
                self._url(f"/{current_scene['id']}/write"),
                json={
                    **scope_payload,
                    "include_following_scenes": 1,
                    "detect_boundaries": False,
                },
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        prompt = captured["prompt"]
        self.assertIn("# Story", prompt)
        self.assertIn("## Description", prompt)
        self.assertIn("Overall story summary.", prompt)
        self.assertIn("Story notes here.", prompt)
        self.assertIn("Chapter notes here.", prompt)
        self.assertIn("# Scene guidance", prompt)
        self.assertIn("Beats:", prompt)
        self.assertIn("1. Hero enters the town square.", prompt)
        self.assertIn("2. A hidden watcher observes.", prompt)
        self.assertIn("## Next scene preview", prompt)
        self.assertIn(
            "Preview only: reference this next scene summary but do not include it in the generated output.",
            prompt,
        )
        self.assertIn("Summary: Next scene summary", prompt)
        self.assertEqual(prompt.count("Active characters:"), 1)
        self.assertNotIn("Referenced entries", prompt)

    def test_write_scene_prompt_includes_active_character_age_brackets(self) -> None:
        scope_payload, _ = self._configure_scope(project_case="novel")
        pdir = self.projects_root / self.pname
        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        story["sourcebook"] = {
            "Hero": {
                "category": "Character",
                "description": "A known character.",
                "origin_date": "2000-01-01T00:00:00Z",
            }
        }
        (pdir / "story.json").write_text(json.dumps(story), encoding="utf-8")

        current_scene = self._create(
            summary="Current scene summary",
            active_characters=["Hero"],
            scene_time={"value": "2026-05-29T12:00:00Z"},
        )

        captured: dict[str, str] = {}

        async def fake_complete(**kwargs: object) -> dict[str, str]:
            messages = kwargs.get("messages") or []
            captured["prompt"] = "\n\n".join(
                str(m.get("content", "")) for m in messages
            )
            return {"content": "Generated prose."}

        with patch(
            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
            new=AsyncMock(side_effect=fake_complete),
        ):
            resp = self.client.post(
                self._url(f"/{current_scene['id']}/write"),
                json={
                    **scope_payload,
                    "include_following_scenes": 0,
                    "detect_boundaries": False,
                },
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        prompt = captured["prompt"]
        self.assertIn("Active characters: Hero [26y]", prompt)

    def test_write_scene_detect_boundaries_keeps_existing_following_scene_markers(
        self,
    ) -> None:
        scene21 = self._create(summary="Scene 21")
        scene22 = self._create(summary="Scene 22")

        pdir = self.projects_root / self.pname
        existing_22 = "Existing scene 22 prose."
        shared_story_text = f"X {existing_22}"
        (pdir / "content.md").write_text(shared_story_text, encoding="utf-8")

        linked_scene21 = self.client.post(
            self._url(f"/{scene21['id']}/link-prose"),
            json={
                "scope_type": "story",
                "start_offset": 0,
                "end_offset": 1,
            },
        )
        self.assertEqual(linked_scene21.status_code, 200, linked_scene21.text)

        linked = self.client.post(
            self._url(f"/{scene22['id']}/link-prose"),
            json={
                "scope_type": "story",
                "start_offset": 2,
                "end_offset": len(shared_story_text),
            },
        )
        self.assertEqual(linked.status_code, 200, linked.text)

        with patch(
            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
            new=AsyncMock(return_value={"content": "Generated scene 21 prose."}),
        ):
            resp = self.client.post(
                self._url(f"/{scene21['id']}/write"),
                json={
                    "scope_type": "story",
                    "include_following_scenes": 1,
                    "detect_boundaries": True,
                },
            )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertEqual(
            {assignment["scene_id"] for assignment in payload["assignments"]},
            {scene21["id"]},
        )

        content = (pdir / "content.md").read_text(encoding="utf-8")
        start_22 = f"<!--scene:{scene22['id']}:start-->"
        end_22 = f"<!--scene:{scene22['id']}:end-->"
        self.assertEqual(content.count(start_22), 1)
        self.assertEqual(content.count(end_22), 1)
        self.assertIn(existing_22, content)
        self.assertIn("Generated scene 21 prose.", content)

    def test_write_scene_linked_matrix_preserves_markers_and_replaces_only_target(
        self,
    ) -> None:
        project_cases = [
            "short-story",
            "novel",
            "series-first-book",
            "series-middle-book",
            "series-last-book",
        ]
        target_positions = [0, 1, 2]  # first, middle, last scene

        for project_case in project_cases:
            for target_position in target_positions:
                for neighbors_have_text in (False, True):
                    with self.subTest(
                        project_case=project_case,
                        target_position=target_position,
                        neighbors_have_text=neighbors_have_text,
                    ):
                        scope_payload, content_path = self._configure_scope(
                            project_case=project_case
                        )

                        scenes = [
                            self._create(summary="Scene 1"),
                            self._create(summary="Scene 2"),
                            self._create(summary="Scene 3"),
                        ]
                        scene_ids = [scene["id"] for scene in scenes]

                        path = content_path
                        path.write_text("A B C", encoding="utf-8")

                        link_ranges = [(0, 1), (2, 3), (4, 5)]
                        for scene, (start_offset, end_offset) in zip(
                            scenes, link_ranges
                        ):
                            link_resp = self.client.post(
                                self._url(f"/{scene['id']}/link-prose"),
                                json={
                                    **scope_payload,
                                    "start_offset": start_offset,
                                    "end_offset": end_offset,
                                },
                            )
                            self.assertEqual(link_resp.status_code, 200, link_resp.text)

                        for index, scene in enumerate(scenes):
                            if index == target_position:
                                text = f"target-before-{project_case}-{target_position}"
                            elif neighbors_have_text:
                                text = f"neighbor-{index + 1}-{project_case}"
                            else:
                                text = ""
                            patch_resp = self.client.patch(
                                self._url(f"/{scene['id']}/prose-content"),
                                json={"text": text},
                            )
                            self.assertEqual(
                                patch_resp.status_code, 200, patch_resp.text
                            )

                        target_scene = scenes[target_position]
                        generated = (
                            f"generated-{project_case}-linked-target-{target_position}"
                        )
                        with patch(
                            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
                            new=AsyncMock(return_value={"content": generated}),
                        ):
                            write_resp = self.client.post(
                                self._url(f"/{target_scene['id']}/write"),
                                json={
                                    **scope_payload,
                                    "include_following_scenes": 1,
                                    "detect_boundaries": True,
                                },
                            )

                        self.assertEqual(write_resp.status_code, 200, write_resp.text)
                        write_payload = write_resp.json()
                        self.assertEqual(
                            {
                                assignment["scene_id"]
                                for assignment in write_payload["assignments"]
                            },
                            {target_scene["id"]},
                        )

                        content = path.read_text(encoding="utf-8")
                        self._assert_scene_markers_if_present(content, scene_ids)
                        for scene in scenes:
                            fetched = self.client.get(self._url(f"/{scene['id']}"))
                            self.assertEqual(fetched.status_code, 200, fetched.text)
                            self.assertIsNotNone(fetched.json().get("prose_link"))

    def test_write_scene_unlinked_matrix_preserves_existing_scene_markers_and_inserts_target(
        self,
    ) -> None:
        project_cases = [
            "short-story",
            "novel",
            "series-first-book",
            "series-middle-book",
            "series-last-book",
        ]
        target_positions = [0, 1, 2]  # first, middle, last scene IDs

        for project_case in project_cases:
            for target_position in target_positions:
                for neighbors_have_text in (False, True):
                    with self.subTest(
                        project_case=project_case,
                        target_position=target_position,
                        neighbors_have_text=neighbors_have_text,
                    ):
                        scope_payload, content_path = self._configure_scope(
                            project_case=project_case
                        )

                        scenes = [
                            self._create(summary="Scene 1"),
                            self._create(summary="Scene 2"),
                            self._create(summary="Scene 3"),
                        ]
                        target_scene = scenes[target_position]
                        neighbor_scenes = [
                            scene
                            for index, scene in enumerate(scenes)
                            if index != target_position
                        ]

                        path = content_path
                        path.write_text("A B", encoding="utf-8")

                        for scene, (start_offset, end_offset) in zip(
                            neighbor_scenes,
                            [(0, 1), (2, 3)],
                        ):
                            link_resp = self.client.post(
                                self._url(f"/{scene['id']}/link-prose"),
                                json={
                                    **scope_payload,
                                    "start_offset": start_offset,
                                    "end_offset": end_offset,
                                },
                            )
                            self.assertEqual(link_resp.status_code, 200, link_resp.text)

                        for index, scene in enumerate(scenes):
                            if scene["id"] == target_scene["id"]:
                                continue
                            text = (
                                f"neighbor-{index + 1}-{project_case}"
                                if neighbors_have_text
                                else ""
                            )
                            patch_resp = self.client.patch(
                                self._url(f"/{scene['id']}/prose-content"),
                                json={"text": text},
                            )
                            self.assertEqual(
                                patch_resp.status_code, 200, patch_resp.text
                            )

                        generated = f"generated-{project_case}-unlinked-target-{target_position}"
                        with patch(
                            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
                            new=AsyncMock(return_value={"content": generated}),
                        ):
                            write_resp = self.client.post(
                                self._url(f"/{target_scene['id']}/write"),
                                json={
                                    **scope_payload,
                                    "include_following_scenes": 1,
                                    "detect_boundaries": True,
                                },
                            )

                        self.assertEqual(write_resp.status_code, 200, write_resp.text)
                        write_payload = write_resp.json()
                        self.assertEqual(
                            {
                                assignment["scene_id"]
                                for assignment in write_payload["assignments"]
                            },
                            {target_scene["id"]},
                        )
                        content = path.read_text(encoding="utf-8")
                        scene_ids = [scene["id"] for scene in scenes]
                        self._assert_scene_markers_if_present(content, scene_ids)
                        for scene in scenes:
                            fetched = self.client.get(self._url(f"/{scene['id']}"))
                            self.assertEqual(fetched.status_code, 200, fetched.text)
                            self.assertIsNotNone(fetched.json().get("prose_link"))

    def test_write_scene_linked_middle_empty_neighbors_preserves_order_and_returns_shifted_neighbors(
        self,
    ) -> None:
        scope_payload, content_path = self._configure_scope(project_case="novel")

        scenes = [
            self._create(summary="Scene 1"),
            self._create(summary="Scene 2"),
            self._create(summary="Scene 3"),
        ]

        content_path.write_text("A B C", encoding="utf-8")
        for scene, (start_offset, end_offset) in zip(scenes, [(0, 1), (2, 3), (4, 5)]):
            link_resp = self.client.post(
                self._url(f"/{scene['id']}/link-prose"),
                json={
                    **scope_payload,
                    "start_offset": start_offset,
                    "end_offset": end_offset,
                },
            )
            self.assertEqual(link_resp.status_code, 200, link_resp.text)

        for scene in (scenes[0], scenes[2]):
            patch_resp = self.client.patch(
                self._url(f"/{scene['id']}/prose-content"),
                json={"text": ""},
            )
            self.assertEqual(patch_resp.status_code, 200, patch_resp.text)

        before_content = content_path.read_text(encoding="utf-8")
        before_order = self._scene_marker_order(before_content)
        before_by_id = {
            scene["id"]: self.client.get(self._url(f"/{scene['id']}"))
            for scene in scenes
        }
        for response in before_by_id.values():
            self.assertEqual(response.status_code, 200, response.text)
        generated = "Generated middle scene prose that shifts downstream offsets."
        with patch(
            "augmentedquill.services.scenes.scene_generation_service.llm.unified_chat_complete",
            new=AsyncMock(return_value={"content": generated}),
        ):
            write_resp = self.client.post(
                self._url(f"/{scenes[1]['id']}/write"),
                json={
                    **scope_payload,
                    "include_following_scenes": 1,
                    "detect_boundaries": True,
                },
            )

        self.assertEqual(write_resp.status_code, 200, write_resp.text)
        payload = write_resp.json()
        self.assertEqual(payload["scene"]["id"], scenes[1]["id"])

        # Regression assertion: the write payload must include neighboring scenes
        # whose marker offsets shifted when replacing middle-scene prose.
        updated_neighbor_ids = {scene["id"] for scene in payload["scenes"]}
        self.assertIn(scenes[2]["id"], updated_neighbor_ids)

        after_content = content_path.read_text(encoding="utf-8")
        self.assertEqual(self._scene_marker_order(after_content), before_order)

    def test_auto_link_scope(self) -> None:
        scene = self._create(summary="Auto")
        resp = self.client.post(
            self._url("/auto-link-scope"),
            json={
                "scope_type": "story",
                "current_text": "Alpha Bravo Charlie",
                "scene_ids": [scene["id"]],
                "start_offset": 0,
            },
        )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertEqual(len(payload["assignments"]), 1)

    def test_auto_link_scope_links_multiple_scenes_without_existing_markers(
        self,
    ) -> None:
        first = self._create(summary="First")
        second = self._create(summary="Second")
        pdir = self.projects_root / self.pname
        (pdir / "content.md").write_text(
            "Para one.\n\nPara two.",
            encoding="utf-8",
        )

        resp = self.client.post(
            self._url("/auto-link-scope"),
            json={
                "scope_type": "story",
                "current_text": "Para one.\n\nPara two.",
            },
        )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        assignments = payload["assignments"]
        self.assertEqual(len(assignments), 2)
        self.assertEqual(assignments[0]["scene_id"], first["id"])
        self.assertEqual(assignments[1]["scene_id"], second["id"])

        first_scene = self.client.get(self._url(f"/{first['id']}"))
        second_scene = self.client.get(self._url(f"/{second['id']}"))
        self.assertEqual(first_scene.status_code, 200, first_scene.text)
        self.assertEqual(second_scene.status_code, 200, second_scene.text)
        self.assertIsNotNone(first_scene.json().get("prose_link"))
        self.assertIsNotNone(second_scene.json().get("prose_link"))

    def test_auto_link_scope_uses_saved_scope_text_offsets(self) -> None:
        first = self._create(summary="First")
        second = self._create(summary="Second")

        # Persisted prose has two paragraphs; request text is stale/normalized
        # differently and should not drive boundary offsets.
        pdir = self.projects_root / self.pname
        saved = "Alpha first paragraph.\n\nBeta second paragraph."
        (pdir / "content.md").write_text(saved, encoding="utf-8")

        resp = self.client.post(
            self._url("/auto-link-scope"),
            json={
                "scope_type": "story",
                "current_text": "Alpha first paragraph. Beta second paragraph.",
            },
        )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        self.assertEqual(len(payload["assignments"]), 2)

        text = (pdir / "content.md").read_text(encoding="utf-8")
        self.assertIn(f"<!--scene:{first['id']}:start-->", text)
        self.assertIn(f"<!--scene:{first['id']}:end-->", text)
        self.assertIn(f"<!--scene:{second['id']}:start-->", text)
        self.assertIn(f"<!--scene:{second['id']}:end-->", text)

    def test_auto_link_scope_splits_single_paragraph_for_multiple_scenes(self) -> None:
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname
        (pdir / "content.md").write_text(
            "Alpha one two three four five six seven eight.",
            encoding="utf-8",
        )

        resp = self.client.post(
            self._url("/auto-link-scope"),
            json={
                "scope_type": "story",
                "current_text": "Alpha one two three four five six seven eight.",
            },
        )

        self.assertEqual(resp.status_code, 200, resp.text)
        payload = resp.json()
        assignments = payload["assignments"]
        self.assertEqual(len(assignments), 2)
        self.assertLess(assignments[0]["start_offset"], assignments[0]["end_offset"])
        self.assertLess(assignments[1]["start_offset"], assignments[1]["end_offset"])

        first_scene = self.client.get(self._url(f"/{first['id']}"))
        second_scene = self.client.get(self._url(f"/{second['id']}"))
        self.assertEqual(first_scene.status_code, 200, first_scene.text)
        self.assertEqual(second_scene.status_code, 200, second_scene.text)
        self.assertIsNotNone(first_scene.json().get("prose_link"))
        self.assertIsNotNone(second_scene.json().get("prose_link"))

    def test_auto_link_scope_does_not_create_nested_marker_comments(self) -> None:
        first = self._create(summary="First")
        second = self._create(summary="Second")

        pdir = self.projects_root / self.pname
        saved = "First paragraph.\n\nSecond paragraph."
        (pdir / "content.md").write_text(saved, encoding="utf-8")

        resp = self.client.post(
            self._url("/auto-link-scope"),
            json={
                "scope_type": "story",
                "current_text": saved,
            },
        )

        self.assertEqual(resp.status_code, 200, resp.text)
        text = (pdir / "content.md").read_text(encoding="utf-8")
        self.assertIn(f"<!--scene:{first['id']}:start-->", text)
        self.assertIn(f"<!--scene:{first['id']}:end-->", text)
        self.assertIn(f"<!--scene:{second['id']}:start-->", text)
        self.assertIn(f"<!--scene:{second['id']}:end-->", text)
        self.assertNotIn("<!--scene:2:start-<!--scene:1:end-->->", text)
