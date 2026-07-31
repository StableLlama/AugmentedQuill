# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Adds REST API contract tests for successful execution and graceful invalid-input handling across backend endpoints."""

import io
import json
from pathlib import Path
from unittest.mock import patch

from fastapi.responses import JSONResponse

from augmentedquill.services.projects.projects import select_project
from tests.unit.api.v1.api_test_case import ApiTestCase


class RestContractsTest(ApiTestCase):
    def setUp(self):
        super().setUp()

        self.config_root = Path(self.user_data_root) / "config"
        self.config_root.mkdir(parents=True, exist_ok=True)
        self.machine_cfg_path = self.config_root / "machine.json"
        self.story_cfg_path = self.config_root / "story.json"

        self._settings_cfg_patchers = [
            patch(
                "augmentedquill.api.v1.settings.DEFAULT_MACHINE_CONFIG_PATH",
                self.machine_cfg_path,
            ),
            patch(
                "augmentedquill.api.v1.settings.DEFAULT_STORY_CONFIG_PATH",
                self.story_cfg_path,
            ),
        ]
        for patcher in self._settings_cfg_patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        ok, msg = select_project("rest_contracts")
        self.assertTrue(ok, msg)

        pdir = self.projects_root / "rest_contracts"
        (pdir / "chapters").mkdir(parents=True, exist_ok=True)
        (pdir / "chapters" / "0001.txt").write_text("Chapter text", encoding="utf-8")
        (pdir / "story.json").write_text(
            json.dumps(
                {
                    "metadata": {"version": 2},
                    "project_title": "REST Contracts",
                    "format": "markdown",
                    "chapters": [{"title": "C1", "summary": "S1"}],
                    "llm_prefs": {"temperature": 0.7, "max_tokens": 256},
                    # ensure tags is an array so schema validation does not
                    # coerce it to an empty string later
                    "tags": [],
                }
            ),
            encoding="utf-8",
        )

        # client is provided by ApiTestCase

    def test_core_and_debug_endpoints_success_and_invalid(self):
        r_health = self.client.get("/api/v1/health")
        self.assertEqual(r_health.status_code, 200)
        self.assertEqual(r_health.json().get("status"), "ok")

        r_machine = self.client.get("/api/v1/machine")
        self.assertEqual(r_machine.status_code, 200)

        r_logs = self.client.get("/api/v1/debug/llm_logs")
        self.assertEqual(r_logs.status_code, 200)
        self.assertIsInstance(r_logs.json()["logs"], list)

        r_clear = self.client.delete("/api/v1/debug/llm_logs")
        self.assertEqual(r_clear.status_code, 200)

        # Graceful malformed JSON handling
        r_bad = self.client.post(
            "/api/v1/chat/tools",
            content="{not-json",
            headers={"content-type": "application/json"},
        )
        self.assertEqual(r_bad.status_code, 400)

        # Successful no-op tools call – response is now SSE; parse the result event.
        r_ok = self.client.post("/api/v1/chat/tools", json={"messages": []})
        self.assertEqual(r_ok.status_code, 200)
        result_event = None
        for line in r_ok.text.splitlines():
            if line.startswith("data: ") and line != "data: [DONE]":
                try:
                    data = json.loads(line[6:])
                    if data.get("type") == "result":
                        result_event = data
                        break
                except json.JSONDecodeError:
                    pass
        self.assertIsNotNone(result_event, "No result event found in SSE response")
        self.assertTrue(result_event.get("ok"))

    def test_settings_endpoints_success_and_invalid(self):
        valid_settings_payload = {
            "story": {
                "llm_prefs": {"temperature": 0.7, "max_tokens": 256},
                # tags default must be an array or schema validation fails
                "tags": [],
            },
            "machine": {
                "openai": {
                    "models": [
                        {
                            "name": "demo",
                            "base_url": "https://example.invalid/v1",
                            "model": "gpt-demo",
                            "timeout_s": 10,
                        }
                    ],
                    "selected": "demo",
                }
            },
        }
        r_settings = self.client.post("/api/v1/settings", json=valid_settings_payload)
        self.assertEqual(r_settings.status_code, 200, r_settings.text)
        self.assertTrue(r_settings.json().get("ok"))

        r_settings_bad = self.client.post(
            "/api/v1/settings",
            content="{bad-json",
            headers={"content-type": "application/json"},
        )
        self.assertEqual(r_settings_bad.status_code, 400)

        # keep existing checks here (already present above)
        r_prompts = self.client.get("/api/v1/prompts")
        self.assertEqual(r_prompts.status_code, 200)
        self.assertTrue(r_prompts.json().get("ok"))
        self.assertIn("languages", r_prompts.json())
        self.assertIn("en", r_prompts.json().get("languages", []))
        self.assertNotIn("prompt_types", r_prompts.json())

        r_presets = self.client.get("/api/v1/machine/presets")
        self.assertEqual(r_presets.status_code, 200)
        self.assertIn("presets", r_presets.json())

        async def fake_list_remote_models(**kwargs):
            return True, ["gpt-demo"], ""

        async def fake_remote_model_exists(**kwargs):
            return True, "ok"

        async def fake_verify_caps(**kwargs):
            return {"supports_function_calling": True}

        r_machine_put = self.client.put(
            "/api/v1/machine",
            json={
                "openai": {
                    "models": [
                        {
                            "name": "demo",
                            "base_url": "https://example.invalid/v1",
                            "model": "gpt-demo",
                            "timeout_s": 10,
                        }
                    ],
                    "selected": "demo",
                }
            },
        )
        self.assertEqual(r_machine_put.status_code, 200)
        self.assertTrue(r_machine_put.json().get("ok"))

        # invalid semantic selection is normalized by backend; still should succeed gracefully
        r_machine_put_invalid = self.client.put(
            "/api/v1/machine",
            json={
                "openai": {
                    "models": [
                        {
                            "name": "demo",
                            "base_url": "https://example.invalid/v1",
                            "model": "gpt-demo",
                        }
                    ],
                    "selected": "missing",
                }
            },
        )
        self.assertEqual(r_machine_put_invalid.status_code, 200)
        self.assertTrue(r_machine_put_invalid.json().get("ok"))

    def test_prompts_endpoint_excludes_prompt_types(self):
        # independent of settings payload, /prompts should not include any
        # prompt_types mapping.
        r_prompts = self.client.get("/api/v1/prompts")
        self.assertEqual(r_prompts.status_code, 200)
        self.assertTrue(r_prompts.json().get("ok"))
        self.assertNotIn("prompt_types", r_prompts.json())

        # the remaining logic from the previous helper tests is not needed
        # here; this method simply verifies prompt_types absence.

    def test_projects_endpoints_success_and_invalid(self):
        r_list = self.client.get("/api/v1/projects")
        self.assertEqual(r_list.status_code, 200)
        self.assertIn("available", r_list.json())

        # default language (missing) should succeed
        r_create = self.client.post(
            "/api/v1/projects/create",
            json={"name": "proj_new", "type": "novel"},
        )
        self.assertEqual(r_create.status_code, 200)
        # explicit language included in request
        r_create_lang = self.client.post(
            "/api/v1/projects/create",
            json={"name": "proj_new2", "type": "novel", "language": "es"},
        )
        self.assertEqual(r_create_lang.status_code, 200)

        r_select = self.client.post(
            "/api/v1/projects/select", json={"name": "proj_new"}
        )
        self.assertEqual(r_select.status_code, 200)

        r_convert = self.client.post(
            "/api/v1/projects/convert", json={"target_type": "series"}
        )
        self.assertEqual(r_convert.status_code, 200)

        r_books_create = self.client.post(
            "/api/v1/books/create", json={"name": "Book A"}
        )
        self.assertEqual(r_books_create.status_code, 200)

        # invalid payload shape -> validation error (graceful)
        r_books_delete_invalid = self.client.post("/api/v1/books/delete", json={})
        self.assertEqual(r_books_delete_invalid.status_code, 422)

        # image metadata endpoints
        r_images_list = self.client.get("/api/v1/projects/images/list")
        self.assertEqual(r_images_list.status_code, 200)

        r_create_placeholder = self.client.post(
            "/api/v1/projects/images/create_placeholder",
            json={"description": "Placeholder image"},
        )
        self.assertEqual(r_create_placeholder.status_code, 200)

        r_update_desc = self.client.post(
            "/api/v1/projects/images/update_description",
            json={"filename": "missing.png", "description": "desc"},
        )
        self.assertIn(r_update_desc.status_code, (200, 400))

        # upload success
        file_bytes = io.BytesIO(b"\x89PNG\r\n\x1a\n")
        r_upload = self.client.post(
            "/api/v1/projects/images/upload",
            files={"file": ("upload.png", file_bytes, "image/png")},
        )
        self.assertEqual(r_upload.status_code, 200)

        # upload invalid (missing file)
        r_upload_invalid = self.client.post("/api/v1/projects/images/upload")
        self.assertEqual(r_upload_invalid.status_code, 422)

        # get and delete image endpoints are graceful for missing/existing files
        r_get_missing = self.client.get("/api/v1/projects/images/missing.png")
        self.assertIn(r_get_missing.status_code, (200, 404))

        r_delete_image = self.client.post(
            "/api/v1/projects/images/delete", json={"filename": "upload.png"}
        )
        self.assertIn(r_delete_image.status_code, (200, 400, 404))

        # export/import routes should return non-500 on invalid usage
        r_export = self.client.get(
            "/api/v1/projects/export", params={"name": "proj_new"}
        )
        self.assertIn(r_export.status_code, (200, 400, 404))

        r_import_invalid = self.client.post(
            "/api/v1/projects/import",
            files={"file": ("not-a-project.txt", io.BytesIO(b"x"), "text/plain")},
        )
        self.assertIn(r_import_invalid.status_code, (200, 400, 422))

        r_delete_project = self.client.post(
            "/api/v1/projects/delete", json={"name": "proj_new"}
        )
        self.assertEqual(r_delete_project.status_code, 200)

    def test_openai_models_proxy_success_and_invalid(self):
        async def fake_proxy(_payload):
            return JSONResponse(status_code=200, content={"data": [{"id": "m1"}]})

        with patch(
            "augmentedquill.api.v1.chat.proxy_openai_models", side_effect=fake_proxy
        ):
            r_ok = self.client.post(
                "/api/v1/openai/models",
                json={"base_url": "https://example.invalid/v1", "timeout_s": 3},
            )
            self.assertEqual(r_ok.status_code, 200)
            self.assertEqual(r_ok.json().get("data", [{}])[0].get("id"), "m1")

        r_invalid = self.client.post(
            "/api/v1/openai/models",
            content="{bad-json",
            headers={"content-type": "application/json"},
        )
        self.assertEqual(r_invalid.status_code, 400)
