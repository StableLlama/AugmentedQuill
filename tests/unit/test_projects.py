import json
import os
import tempfile
from pathlib import Path
from unittest import TestCase

from app.projects import (
    validate_project_dir,
    initialize_project_dir,
    select_project,
    load_registry,
    write_chapter_content,
    write_chapter_summary,
)


class ProjectsTest(TestCase):
    def setUp(self):
        # Point registry and projects root to temp locations
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.projects_root = Path(self.td.name) / "projects"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        self.projects_root.mkdir(parents=True, exist_ok=True)
        # Ensure clean
        if self.registry_path.exists():
            self.registry_path.unlink()

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)

    def test_validate_empty_then_initialize(self):
        with tempfile.TemporaryDirectory() as pd:
            p = Path(pd)
            info = validate_project_dir(p)
            self.assertFalse(info.is_valid)
            self.assertEqual(info.reason, "empty")
            initialize_project_dir(p, project_title="Test")
            info2 = validate_project_dir(p)
            self.assertTrue(info2.is_valid)

    def test_validate_existing_valid_project(self):
        with tempfile.TemporaryDirectory() as pd:
            p = Path(pd)
            initialize_project_dir(p, project_title="X")
            # Create a dummy chapter
            ch = p / "chapters" / "000-intro.md"
            ch.parent.mkdir(parents=True, exist_ok=True)
            ch.write_text("Hello", encoding="utf-8")
            info = validate_project_dir(p)
            self.assertTrue(info.is_valid)

    def test_select_creates_when_missing_or_empty(self):
        # missing by name
        missing_name = "newproj"
        ok, msg = select_project(missing_name)
        self.assertTrue(ok)
        self.assertIn("Project", msg)
        self.assertTrue(self.registry_path.exists())
        reg = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg.get("current"), str(self.projects_root / missing_name))

        # empty dir under projects root by name
        empty_name = "empty"
        (self.projects_root / empty_name).mkdir(parents=True, exist_ok=True)
        ok2, msg2 = select_project(empty_name)
        self.assertTrue(ok2)
        reg2 = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg2.get("current"), str(self.projects_root / empty_name))

    def test_select_rejects_non_project(self):
        # Create a directory under projects root that is not a valid project
        bad_name = "badproj"
        bad_dir = self.projects_root / bad_name
        bad_dir.mkdir(parents=True, exist_ok=True)
        (bad_dir / "random.txt").write_text("not a project", encoding="utf-8")
        ok, msg = select_project(bad_name)
        self.assertFalse(ok)
        self.assertIn("not a valid", msg)

    def test_mru_capped_at_5(self):
        # Create 6 projects by name
        created_names = []
        for i in range(6):
            name = f"p{i}"
            ok, _ = select_project(name)
            self.assertTrue(ok)
            created_names.append(name)
        reg = load_registry()
        expected_current = str(self.projects_root / created_names[-1])
        self.assertEqual(reg["current"], expected_current)
        self.assertLessEqual(len(reg["recent"]), 5)
        # Ensure latest is first
        self.assertEqual(reg["recent"][0], expected_current)

    def test_write_chapter_content(self):
        # Create a test project with a chapter
        project_name = "test_write_content"
        ok, _ = select_project(project_name)
        self.assertTrue(ok)
        project_dir = self.projects_root / project_name
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        chapter_file = chapters_dir / "0001.txt"
        chapter_file.write_text("Original content", encoding="utf-8")

        # Write new content
        new_content = "New chapter content"
        write_chapter_content(1, new_content)

        # Check the file was updated
        self.assertEqual(chapter_file.read_text(encoding="utf-8"), new_content)

    def test_write_chapter_summary(self):
        # Create a test project with story.json
        project_name = "test_write_summary"
        ok, _ = select_project(project_name)
        self.assertTrue(ok)
        project_dir = self.projects_root / project_name
        story_file = project_dir / "story.json"
        initial_story = {"chapters": [{"title": "Chapter 1", "summary": "Old summary"}]}
        story_file.write_text(json.dumps(initial_story, indent=2), encoding="utf-8")
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)
        chapter_file = chapters_dir / "0001.txt"
        chapter_file.write_text("Content", encoding="utf-8")

        # Write new summary
        new_summary = "New chapter summary"
        write_chapter_summary(1, new_summary)

        # Check the story.json was updated
        updated_story = json.loads(story_file.read_text(encoding="utf-8"))
        self.assertEqual(updated_story["chapters"][0]["summary"], new_summary)
