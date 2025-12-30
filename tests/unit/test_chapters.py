import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from app.main import app
from app.projects import select_project


class ChaptersApiTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        self.client = TestClient(app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def _make_project_with_chapters(self, name: str = "novel") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        # Create two 4-digit files
        (chdir / "0001.txt").write_text("Chapter One\nHello world.", encoding="utf-8")
        (chdir / "0002.txt").write_text(
            "Second Chapter\nMore content.", encoding="utf-8"
        )
        # story.json chapters titles
        (pdir / "story.json").write_text(
            '{"project_title":"X","format":"markdown","chapters":["Intro","Climax"],"llm_prefs":{"temperature":0.7,"max_tokens":2048}}',
            encoding="utf-8",
        )
        return pdir

    def test_list_and_fetch_chapters(self):
        self._make_project_with_chapters()
        # List
        r = self.client.get("/api/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data.get("chapters")
        self.assertIsInstance(chs, list)
        # Expect two chapters sorted by id [1,2]
        self.assertEqual([c["id"] for c in chs], [1, 2])
        # Titles from story.json
        self.assertEqual([c["title"] for c in chs], ["Intro", "Climax"])

        # Fetch first chapter by id
        r1 = self.client.get("/api/chapters/1")
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1["id"], 1)
        self.assertIn("Hello world.", d1["content"])

    def test_filename_fallback_when_no_titles(self):
        # Setup project with two numbered files and an empty chapters list in story.json
        ok, msg = select_project("nofmt")
        self.assertTrue(ok, msg)
        pdir = self.projects_root / "nofmt"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("First content", encoding="utf-8")
        (chdir / "0002.txt").write_text("Second content", encoding="utf-8")
        # Write story.json with empty titles array
        (pdir / "story.json").write_text(
            '{"project_title":"Y","format":"markdown","chapters":[],"llm_prefs":{"temperature":0.7,"max_tokens":2048}}',
            encoding="utf-8",
        )

        r = self.client.get("/api/chapters")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        chs = data.get("chapters")
        self.assertEqual([c["id"] for c in chs], [1, 2])
        # Titles should fall back to the filename when no titles provided
        self.assertEqual([c["title"] for c in chs], ["0001.txt", "0002.txt"])

        r1 = self.client.get("/api/chapters/1")
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1["title"], "0001.txt")
