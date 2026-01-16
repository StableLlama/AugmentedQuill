# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import os
import json
import tempfile
import base64
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import create_app
from app.projects import select_project, create_project
from app.helpers.image_helpers import (
    load_image_metadata,
    get_project_images,
    update_image_metadata,
)
from app.api.chat import _inject_project_images, _exec_chat_tool


class ImageFeaturesTest(TestCase):
    def setUp(self):
        # Environment setup for isolated project
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.projects_root = Path(self.td.name) / "projects"
        self.projects_root.mkdir(parents=True, exist_ok=True)
        self.registry_path = Path(self.td.name) / "projects.json"
        os.environ["AUGQ_PROJECTS_ROOT"] = str(self.projects_root)
        os.environ["AUGQ_PROJECTS_REGISTRY"] = str(self.registry_path)

        # Create and select a test project
        self.project_name = "image_test_proj"
        create_project(self.project_name)
        select_project(self.project_name)

        self.active_project_dir = self.projects_root / "image_test_proj"
        self.images_dir = self.active_project_dir / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)

        # Setup Client
        self.app = create_app()
        self.client = TestClient(self.app)

    def tearDown(self):
        os.environ.pop("AUGQ_PROJECTS_ROOT", None)
        os.environ.pop("AUGQ_PROJECTS_REGISTRY", None)

    def test_image_helpers(self):
        """Test helpers for metadata and listing."""
        # Create a file
        (self.images_dir / "test1.png").write_bytes(b"fake data")

        # Check initial list
        imgs = get_project_images()
        self.assertEqual(len(imgs), 1)
        self.assertEqual(imgs[0]["filename"], "test1.png")
        self.assertFalse(imgs[0]["is_placeholder"])
        self.assertEqual(imgs[0]["description"], "")
        self.assertEqual(imgs[0]["title"], "test1.png")

        # Update description and title
        update_image_metadata(
            "test1.png", description="A nice test image", title="My Title"
        )

        # Check metadata file created
        meta_file = self.images_dir / "metadata.json"
        self.assertTrue(meta_file.exists())
        meta = json.loads(meta_file.read_text())

        # Determine format (the code now saves versioned, so we expect versioned)
        if "version" in meta:
            self.assertEqual(meta["version"], 1)
            items = meta["items"]
        else:
            items = meta

        self.assertEqual(items["test1.png"]["description"], "A nice test image")
        self.assertEqual(items["test1.png"]["title"], "My Title")

        # Check list again
        imgs = get_project_images()
        self.assertEqual(imgs[0]["description"], "A nice test image")
        self.assertEqual(imgs[0]["title"], "My Title")

        # Create placeholder via helper
        update_image_metadata(
            "placeholder.png", description="Just a dream", title="Dreamy"
        )
        imgs = get_project_images()  # Should now have 2 items
        self.assertEqual(len(imgs), 2)

        # Sort order might vary, find the placeholder
        ph = next(i for i in imgs if i.get("is_placeholder"))
        self.assertEqual(ph["filename"], "placeholder.png")
        self.assertEqual(ph["description"], "Just a dream")
        self.assertEqual(ph["title"], "Dreamy")
        self.assertIsNone(ph["url"])

    def test_endpoints_crud(self):
        """Test the REST API endpoints for images."""
        # 1. List empty
        resp = self.client.get("/api/projects/images/list")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["images"], [])

        # 2. Upload
        files = {"file": ("uploaded.png", b"pngdata", "image/png")}
        resp = self.client.post("/api/projects/images/upload", files=files)
        self.assertEqual(resp.status_code, 200)
        filename = resp.json()["filename"]

        # 3. Create Placeholder
        resp = self.client.post(
            "/api/projects/images/create_placeholder",
            json={"description": "A sketch", "title": "Sketchy"},
        )
        self.assertEqual(resp.status_code, 200)
        ph_filename = resp.json()["filename"]
        self.assertTrue(ph_filename.startswith("placeholder_"))

        # 4. List again
        resp = self.client.get("/api/projects/images/list")
        images = resp.json()["images"]
        self.assertEqual(len(images), 2)
        ph = next(i for i in images if i["filename"] == ph_filename)
        self.assertEqual(ph["title"], "Sketchy")

        # 5. Update description
        resp = self.client.post(
            "/api/projects/images/update_description",
            json={
                "filename": filename,
                "description": "Real Upload",
                "title": "Real Title",
            },
        )
        self.assertEqual(resp.status_code, 200)

        # Verify
        resp = self.client.get("/api/projects/images/list")
        images = resp.json()["images"]
        upl = next(i for i in images if i["filename"] == filename)
        self.assertEqual(upl["description"], "Real Upload")
        self.assertEqual(upl["title"], "Real Title")

        # 6. Delete Upload
        resp = self.client.post(
            "/api/projects/images/delete", json={"filename": filename}
        )
        self.assertEqual(resp.status_code, 200)

        # Check it is gone from meta and disk
        self.assertFalse((self.images_dir / filename).exists())
        meta = load_image_metadata()
        self.assertNotIn(filename, meta)

    async def _test_inject_images_impl(self):
        """Test that images mentioned in user message are injected as base64."""
        # Setup async test for _inject_project_images

        # Create image
        img_path = self.images_dir / "ref.png"
        img_path.write_bytes(b"fake_image_content")

        messages = [{"role": "user", "content": "Look at ref.png please."}]

        await _inject_project_images(messages)

        new_content = messages[0]["content"]
        self.assertIsInstance(new_content, list)
        self.assertEqual(new_content[0]["text"], "Look at ref.png please.")
        self.assertEqual(new_content[1]["type"], "image_url")
        data_url = new_content[1]["image_url"]["url"]
        self.assertTrue(data_url.startswith("data:image/png;base64,"))

        # Verify base64
        b64Part = data_url.split(",")[1]
        decoded = base64.b64decode(b64Part)
        self.assertEqual(decoded, b"fake_image_content")

    def test_inject_images(self):
        """Run the async test in the sync TestCase."""
        import asyncio

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._test_inject_images_impl())
        finally:
            loop.close()

    async def _test_tool_generate_description_impl(self):
        """Test the generate_image_description tool."""
        # Create image
        img_path = self.images_dir / "desc_test.jpg"
        img_path.write_bytes(b"content")

        # Mock LLM response
        mock_resp = {"choices": [{"message": {"content": "A beautiful sunset."}}]}

        with patch("app.llm.openai_chat_complete", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_resp

            payload = {"messages": [], "model_name": "gpt-4o"}
            call_id = "call_123"
            mutations = {}

            # Test Tool 1: list_images
            res = await _exec_chat_tool("list_images", {}, call_id, payload, mutations)
            content = json.loads(res["content"])
            # Should have ref.png from previous test? No, clean dir each setUp.
            # But wait, we just created desc_test.jpg
            self.assertEqual(content[0]["filename"], "desc_test.jpg")

            # Test Tool 2: generate_image_description
            res = await _exec_chat_tool(
                "generate_image_description",
                {"filename": "desc_test.jpg"},
                call_id,
                payload,
                mutations,
            )
            resp_content = json.loads(res["content"])
            self.assertEqual(resp_content["description"], "A beautiful sunset.")

            # Verify description saved
            meta = load_image_metadata()
            self.assertEqual(
                meta["desc_test.jpg"]["description"], "A beautiful sunset."
            )

            # Verify tool inputs
            mock_llm.assert_called_once()
            args = mock_llm.call_args[1]
            # Check if image was sent
            sent_msgs = args["messages"]
            user_msg = sent_msgs[1]["content"]  # 0 is system
            self.assertEqual(user_msg[1]["type"], "image_url")
            self.assertIn("data:image/jpeg;base64,", user_msg[1]["image_url"]["url"])

            # Test Tool 3: create_image_placeholder
            res = await _exec_chat_tool(
                "create_image_placeholder",
                {"description": "A ghost", "title": "Ghost"},
                call_id,
                payload,
                mutations,
            )
            resp_content = json.loads(res["content"])
            self.assertTrue(resp_content["filename"].startswith("placeholder_"))

            meta = load_image_metadata()
            fname = resp_content["filename"]
            self.assertEqual(meta[fname]["description"], "A ghost")
            self.assertEqual(meta[fname]["title"], "Ghost")

    def test_tools_async(self):
        import asyncio

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._test_tool_generate_description_impl())
        finally:
            loop.close()
