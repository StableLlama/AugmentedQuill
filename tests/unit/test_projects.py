import json
import os
import shutil
import tempfile
from pathlib import Path
from unittest import TestCase

from app.projects import (
    validate_project_dir,
    initialize_project_dir,
    select_project,
    load_registry,
    REGISTRY_PATH,
)


class ProjectsTest(TestCase):
    def setUp(self):
        # Point registry to a temp location
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)
        # Ensure clean
        if self.registry_path.exists():
            self.registry_path.unlink()

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

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
        # missing path
        missing = Path(self.td.name) / "newproj"
        ok, msg = select_project(str(missing))
        self.assertTrue(ok)
        self.assertIn("Project", msg)
        self.assertTrue(self.registry_path.exists())
        reg = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg.get("current"), str(missing))

        # empty dir path
        empty_dir = Path(self.td.name) / "empty"
        empty_dir.mkdir(parents=True, exist_ok=True)
        ok2, msg2 = select_project(str(empty_dir))
        self.assertTrue(ok2)
        reg2 = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(reg2.get("current"), str(empty_dir))

    def test_select_rejects_non_project(self):
        with tempfile.TemporaryDirectory() as pd:
            p = Path(pd)
            (p / "random.txt").write_text("not a project", encoding="utf-8")
            ok, msg = select_project(str(p))
            self.assertFalse(ok)
            self.assertIn("not a valid", msg)

    def test_mru_capped_at_5(self):
        # Create 6 projects
        created = []
        for i in range(6):
            d = Path(self.td.name) / f"p{i}"
            ok, _ = select_project(str(d))
            self.assertTrue(ok)
            created.append(str(d))
        reg = load_registry()
        self.assertEqual(reg["current"], created[-1])
        self.assertLessEqual(len(reg["recent"]), 5)
        # Ensure latest is first
        self.assertEqual(reg["recent"][0], created[-1])
