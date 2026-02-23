# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test config unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import tempfile
import json
from pathlib import Path
from unittest import TestCase

from augmentedquill.core.config import load_machine_config, load_story_config


class ConfigLoaderTest(TestCase):
    def test_machine_config_env_overrides_file_and_defaults(self):
        with tempfile.TemporaryDirectory() as td:
            cfg_path = Path(td) / "machine.json"
            cfg_path.write_text(
                json.dumps(
                    {
                        "openai": {
                            "api_key": "${OPENAI_API_KEY}",
                            "base_url": "https://api.example.com/v1",
                            "model": "gpt-old",
                            "timeout_s": 10,
                        }
                    }
                ),
                encoding="utf-8",
            )

            # defaults
            defaults = {
                "openai": {
                    "base_url": "https://default.invalid/v1",
                    "model": "gpt-default",
                    "timeout_s": 5,
                }
            }

            # env overrides
            os.environ["OPENAI_API_KEY"] = "KEY_FROM_ENV"
            os.environ["OPENAI_MODEL"] = "gpt-env"
            os.environ["OPENAI_TIMEOUT_S"] = "20"

            try:
                cfg = load_machine_config(cfg_path, defaults)
            finally:
                # cleanup env vars to avoid cross-test pollution
                os.environ.pop("OPENAI_API_KEY")
                os.environ.pop("OPENAI_MODEL")
                os.environ.pop("OPENAI_TIMEOUT_S")

            self.assertEqual(cfg["openai"]["api_key"], "KEY_FROM_ENV")
            self.assertEqual(cfg["openai"]["base_url"], "https://api.example.com/v1")
            self.assertEqual(cfg["openai"]["model"], "gpt-env")
            self.assertEqual(cfg["openai"]["timeout_s"], 20)

    def test_story_config_interpolates_env_placeholders(self):
        with tempfile.TemporaryDirectory() as td:
            cfg_path = Path(td) / "story.json"
            os.environ["PROJECT_TITLE"] = "My Novel"
            try:
                cfg_path.write_text(
                    json.dumps(
                        {
                            "metadata": {"version": 2},
                            "project_title": "${PROJECT_TITLE}",
                            "format": "markdown",
                            "chapters": ["000-intro.md", "010-conflict.md"],
                            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
                        }
                    ),
                    encoding="utf-8",
                )
                cfg = load_story_config(cfg_path)
            finally:
                os.environ.pop("PROJECT_TITLE")

            self.assertEqual(cfg["project_title"], "My Novel")
            self.assertEqual(cfg["format"], "markdown")
            self.assertEqual(cfg["chapters"], ["000-intro.md", "010-conflict.md"])
