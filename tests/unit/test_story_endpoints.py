import os
import tempfile
from pathlib import Path
from unittest import TestCase

from fastapi.testclient import TestClient

from app.main import app
import app.llm as llm
from app.projects import select_project


class StoryEndpointsTest(TestCase):
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

    def _make_project(self, name: str = "novel") -> Path:
        ok, msg = select_project(name)
        self.assertTrue(ok, msg)
        pdir = self.projects_root / name
        chdir = pdir / "chapters"
        chdir.mkdir(parents=True, exist_ok=True)
        (chdir / "0001.txt").write_text("Chapter one text", encoding="utf-8")
        (chdir / "0002.txt").write_text("Chapter two text", encoding="utf-8")
        (pdir / "story.json").write_text(
            '{"project_title":"P","format":"markdown","chapters":[{"title":"T1","summary":"S1"},{"title":"T2","summary":"S2"}],"llm_prefs":{"temperature":0.7,"max_tokens":2048}}',
            encoding="utf-8",
        )
        return pdir

    # ---- PUT /api/chapters/{id}/summary ----
    def test_put_summary_updates_story(self):
        pdir = self._make_project()
        r = self.client.put("/api/chapters/1/summary", json={"summary": "New summary"})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["chapter"]["summary"], "New summary")
        # Verify persisted
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "New summary")

    def test_put_summary_404_invalid_id(self):
        self._make_project()
        r = self.client.put("/api/chapters/999/summary", json={"summary": "X"})
        self.assertEqual(r.status_code, 404)

    # ---- Story LLM endpoints with fakes ----
    def _patch_llm(self):
        # Patch credentials and completion in app.llm
        self._orig_resolve = llm.resolve_openai_credentials
        self._orig_complete = llm.openai_chat_complete

        async def fake_complete(**kwargs):  # type: ignore
            # Return a minimal OpenAI-like response
            content = kwargs.get("messages", [{}])[-1].get("content", "")
            # If asked to write chapter, return a known text
            if "Task: Write the full chapter" in content:
                txt = "AI chapter body"
            elif "Task: Continue the chapter" in content:
                txt = "AI continuation"
            else:
                txt = "AI summary"
            return {"choices": [{"message": {"role": "assistant", "content": txt}}]}

        llm.resolve_openai_credentials = lambda payload: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
        )  # type: ignore
        llm.openai_chat_complete = fake_complete  # type: ignore

        def _undo():
            llm.resolve_openai_credentials = self._orig_resolve  # type: ignore
            llm.openai_chat_complete = self._orig_complete  # type: ignore

        self.addCleanup(_undo)

    def test_story_summary_updates_and_persists(self):
        pdir = self._make_project()
        self._patch_llm()
        r = self.client.post(
            "/api/story/summary",
            json={"chap_id": 1, "mode": "update", "model_name": "fake"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data.get("ok"))
        self.assertEqual(data["summary"], "AI summary")
        import json

        story = json.loads((pdir / "story.json").read_text(encoding="utf-8"))
        self.assertEqual(story["chapters"][0]["summary"], "AI summary")

    def test_story_write_overwrites_file(self):
        pdir = self._make_project()
        self._patch_llm()
        # Ensure summary exists
        r = self.client.post(
            "/api/story/write", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data.get("content"), "AI chapter body")
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertEqual(text, "AI chapter body")

    def test_story_continue_appends(self):
        pdir = self._make_project()
        self._patch_llm()
        # continue
        r = self.client.post(
            "/api/story/continue", json={"chap_id": 1, "model_name": "fake"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertIn("AI continuation", data.get("content", ""))
        text = (pdir / "chapters" / "0001.txt").read_text(encoding="utf-8")
        self.assertIn("AI continuation", text)

    def test_story_endpoints_404_for_invalid_id(self):
        self._make_project()
        self._patch_llm()
        for path in ("/api/story/summary", "/api/story/write", "/api/story/continue"):
            r = self.client.post(path, json={"chap_id": 999, "model_name": "fake"})
            self.assertEqual(r.status_code, 404, path)

    def test_suggest_endpoint_streams_paragraph(self):
        """Ensure `/api/story/suggest` is registered and returns streaming text."""
        self._make_project()

        # Patch the completions stream used by the suggest endpoint
        orig_stream = llm.openai_completions_stream

        async def fake_stream(prompt: str, **kwargs):
            # Yield a few chunks as the real stream would
            yield "First chunk of suggestion"
            yield " and the rest of the paragraph.\n"

        llm.openai_completions_stream = fake_stream  # type: ignore
        # Also ensure credential resolution succeeds for this test
        orig_resolve = llm.resolve_openai_credentials
        llm.resolve_openai_credentials = lambda payload: (
            "https://fake.local/v1",
            None,
            "fake-model",
            5,
        )  # type: ignore

        def _undo():
            llm.openai_completions_stream = orig_stream  # type: ignore
            llm.resolve_openai_credentials = orig_resolve  # type: ignore

        self.addCleanup(_undo)

        # Call the suggest endpoint
        r = self.client.post(
            "/api/story/suggest", json={"chap_id": 1, "current_text": "Hello"}
        )
        self.assertEqual(r.status_code, 200, r.text)
        # Response should be plain text and return non-empty content
        self.assertTrue(r.headers.get("content-type", "").startswith("text/plain"))
        text = r.text or ""
        self.assertGreater(len(text.strip()), 0, f"empty response body: {repr(text)}")
