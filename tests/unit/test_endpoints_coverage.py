import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from app.main import app
import app.llm as llm
from app.projects import select_project


class EndpointsCoverageTest(TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        # create a simple project with two chapters to satisfy chapter endpoints
        ok, msg = select_project("coverage_proj")
        assert ok, msg
        pdir = self.projects_root / "coverage_proj"
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Chapter one text", encoding="utf-8")
        (chdir / "0002.txt").write_text("Chapter two text", encoding="utf-8")
        (pdir / "story.json").write_text(
            json.dumps(
                {
                    "project_title": "Coverage",
                    "format": "markdown",
                    "chapters": [
                        {"title": "T1", "summary": "S1"},
                        {"title": "T2", "summary": "S2"},
                    ],
                    "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
                }
            ),
            encoding="utf-8",
        )

        # Patch LLM module to deterministic fakes to avoid network calls
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_complete = llm.openai_chat_complete
        self._orig_complete_stream = llm.openai_chat_complete_stream
        self._orig_completions_stream = llm.openai_completions_stream

        llm.resolve_openai_credentials = lambda payload: (
            "https://fake",
            None,
            "fake",
            5,
        )  # type: ignore

        async def fake_complete(**kwargs):
            return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}

        async def fake_complete_stream(**kwargs):
            for c in ("o", "k"):
                yield c

        async def fake_completions_stream(**kwargs):
            yield "suggestion chunk"

        llm.openai_chat_complete = fake_complete  # type: ignore
        llm.openai_chat_complete_stream = fake_complete_stream  # type: ignore
        llm.openai_completions_stream = fake_completions_stream  # type: ignore

        self.addCleanup(self._undo_patches)

        self.client = TestClient(app)

    def _undo_patches(self):
        llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
        llm.openai_chat_complete = self._orig_complete  # type: ignore
        llm.openai_chat_complete_stream = self._orig_complete_stream  # type: ignore
        llm.openai_completions_stream = self._orig_completions_stream  # type: ignore

    def test_all_registered_routes_have_methods(self):
        """Assert every registered FastAPI route has a path and allowed methods.

        This test validates route registration without issuing HTTP requests to
        avoid side effects; functional endpoint behavior is covered by other unit tests.
        """
        routes = [r for r in app.routes if getattr(r, "path", None)]
        self.assertGreater(len(routes), 0, "No routes registered on app")
        for r in routes:
            path = getattr(r, "path", None)
            methods = getattr(r, "methods", None) or set()
            # Exclude static and docs-presentation routes from strict checks
            if path.startswith(("/static", "/docs", "/openapi.json", "/redoc")):
                continue
            self.assertIsInstance(path, str)
            self.assertTrue(path.startswith("/"))
            self.assertTrue(methods, f"Route {path} exposes no HTTP methods")
