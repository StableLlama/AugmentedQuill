# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the test config unit so this responsibility stays isolated, testable, and easy to evolve."""

import json
import logging
import os
import tempfile
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

    def test_story_config_loads_legacy_scene_prose_link_fields(self):
        with tempfile.TemporaryDirectory() as td:
            project_dir = Path(td)
            story_path = project_dir / "story.json"
            (project_dir / "content.md").write_text(
                "Hello legacy world",
                encoding="utf-8",
            )
            story_path.write_text(
                json.dumps(
                    {
                        "metadata": {"version": 4},
                        "project_title": "Legacy",
                        "format": "markdown",
                        "scenes": {
                            "1": {
                                "summary": "Legacy scene",
                                "beats": [],
                                "active_characters": [],
                                "passive_characters": [],
                                "sourcebook_entry_ids": [],
                                "location": None,
                                "time": None,
                                "scene_time": None,
                                "color_tag": None,
                                "causes": [],
                                "pinboard_x": 0,
                                "pinboard_y": 0,
                                "status": "active",
                                "prose_link": {
                                    "scope_type": "story",
                                    "start_offset": 0,
                                    "end_offset": 5,
                                    "content_hash": "2095b47960c1dc52",
                                    "is_stale": False,
                                },
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            loaded = load_story_config(story_path)
            scenes = loaded.get("scenes")
            self.assertTrue(isinstance(scenes, dict))
            self.assertTrue(isinstance(scenes.get("1"), dict))
            prose_link = scenes["1"].get("prose_link")
            self.assertTrue(isinstance(prose_link, dict))
            self.assertEqual(prose_link.get("scope_type"), "story")
            self.assertEqual(prose_link.get("content_hash"), "2095b47960c1dc52")
            self.assertEqual(prose_link.get("is_stale"), False)


class MachineSchemaValidationTest(TestCase):
    """Tests for schema-based validation inside load_machine_config."""

    def _minimal_valid_machine(self) -> dict:
        return {
            "openai": {
                "models": [
                    {
                        "name": "test-model",
                        "base_url": "https://api.example.com/v1",
                        "api_key": "sk-test",
                        "timeout_s": 30,
                        "model": "gpt-4o",
                    }
                ],
                "selected": "test-model",
            }
        }

    def test_valid_machine_config_loads_without_warning(self):
        with tempfile.TemporaryDirectory() as td:
            cfg_path = Path(td) / "machine.json"
            cfg_path.write_text(
                json.dumps(self._minimal_valid_machine()), encoding="utf-8"
            )
            with self.assertLogs(
                "augmentedquill.core.config", level=logging.WARNING
            ) as cm:
                # Trigger a different harmless warning so assertLogs doesn't fail
                # when no warning is emitted.  We verify our warning is absent.
                import logging as _logging

                _logging.getLogger("augmentedquill.core.config").warning("sentinel")
                load_machine_config(cfg_path)

            # Our validation warning should not appear; only the sentinel should.
            machine_warnings = [
                m for m in cm.output if "invalid" in m or "Could not validate" in m
            ]
            self.assertEqual(machine_warnings, [])

    def test_invalid_machine_config_emits_warning_but_returns_data(self):
        """A machine config violating the schema emits a warning but still loads."""
        with tempfile.TemporaryDirectory() as td:
            cfg_path = Path(td) / "machine.json"
            # Missing required fields in the model object (name, base_url, etc.)
            cfg_path.write_text(
                json.dumps(
                    {"openai": {"models": [{"bad_field": True}], "selected": ""}}
                ),
                encoding="utf-8",
            )
            with self.assertLogs(
                "augmentedquill.core.config", level=logging.WARNING
            ) as cm:
                result = load_machine_config(cfg_path)

            machine_warnings = [
                m for m in cm.output if "machine config" in m and "invalid" in m
            ]
            self.assertTrue(
                len(machine_warnings) >= 1,
                msg=f"Expected a validation warning, got: {cm.output}",
            )
            # Config is returned regardless
            self.assertIn("openai", result)

    def test_empty_machine_config_skips_validation(self):
        """An empty machine.json (fresh install) should not emit any warnings."""
        with tempfile.TemporaryDirectory() as td:
            cfg_path = Path(td) / "machine.json"
            cfg_path.write_text("{}", encoding="utf-8")
            import logging as _logging

            logger = _logging.getLogger("augmentedquill.core.config")
            with self.assertLogs(logger, level=logging.WARNING) as cm:
                logger.warning("sentinel")
                load_machine_config(cfg_path)

            machine_warnings = [m for m in cm.output if "machine config" in m]
            self.assertEqual(machine_warnings, [])
