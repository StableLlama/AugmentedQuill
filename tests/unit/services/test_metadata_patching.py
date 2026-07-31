# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines metadata patching tests so patch behavior stays robust and explicit."""

from unittest import TestCase

from pydantic import ValidationError

from augmentedquill.services.chat.chat_tools.metadata_patching import (
    ConflictListPatch,
    IntListPatch,
    StringListPatch,
    TextPatch,
    apply_conflict_list_patch,
    apply_int_list_patch,
    apply_string_list_patch,
    apply_text_patch,
)


class MetadataPatchingTest(TestCase):
    def test_text_patch_replace(self):
        patch = TextPatch(operation="replace", value="new")
        self.assertEqual(apply_text_patch("old", patch), "new")

    def test_text_patch_append(self):
        patch = TextPatch(operation="append", value=" world")
        self.assertEqual(apply_text_patch("hello", patch), "hello world")

    def test_text_patch_replace_text_unique(self):
        patch = TextPatch(
            operation="replace_text",
            old_text="fox",
            new_text="wolf",
            occurrence="unique",
        )
        self.assertEqual(apply_text_patch("the fox", patch), "the wolf")

    def test_text_patch_replace_text_missing_fails(self):
        patch = TextPatch(operation="replace_text", old_text="x", new_text="y")
        with self.assertRaises(ValueError):
            apply_text_patch("abc", patch)

    def test_text_patch_invalid_shape_fails_validation(self):
        with self.assertRaises(ValidationError):
            TextPatch(operation="append")

    def test_string_list_patch_add_remove(self):
        patch = StringListPatch(add=["c", "a"], remove=["b"])
        self.assertEqual(apply_string_list_patch(["a", "b"], patch), ["a", "c"])

    def test_string_list_patch_clear_and_set(self):
        patch = StringListPatch(clear=True, set=["x", "y"])
        self.assertEqual(apply_string_list_patch(["a"], patch), ["x", "y"])

    def test_int_list_patch_add_remove(self):
        patch = IntListPatch(add=[3, 4], remove=[2])
        self.assertEqual(apply_int_list_patch([1, 2], patch), [1, 3, 4])

    def test_int_list_patch_clear_and_set(self):
        patch = IntListPatch(clear=True, set=[5, 6])
        self.assertEqual(apply_int_list_patch([1, 2], patch), [5, 6])

    def test_conflict_patch_add_update_remove(self):
        patch = ConflictListPatch(
            operations=[
                {"op": "add", "conflict": {"description": "c1", "resolution": ""}},
                {"op": "update", "index": 0, "updates": {"resolution": "done"}},
                {"op": "remove", "index": 0},
            ]
        )
        self.assertEqual(apply_conflict_list_patch([], patch), [])

    def test_conflict_patch_insert_replace(self):
        patch = ConflictListPatch(
            operations=[
                {
                    "op": "insert",
                    "index": 0,
                    "conflict": {"description": "a", "resolution": ""},
                },
                {
                    "op": "replace",
                    "index": 0,
                    "conflict": {"description": "b", "resolution": "open"},
                },
            ]
        )
        result = apply_conflict_list_patch([], patch)
        self.assertEqual(
            result,
            [
                {
                    "id": None,
                    "description": "b",
                    "resolved": False,
                    "resolution": "open",
                }
            ],
        )

    def test_conflict_patch_out_of_bounds_fails(self):
        patch = ConflictListPatch(
            operations=[{"op": "update", "index": 0, "updates": {"resolution": "done"}}]
        )
        with self.assertRaises(ValueError):
            apply_conflict_list_patch([], patch)

    def test_conflict_patch_missing_required_fields_fails_validation(self):
        with self.assertRaises(ValidationError):
            ConflictListPatch(operations=[{"op": "replace", "index": 0}])

    def test_conflict_patch_rejects_json_patch_path_field(self):
        with self.assertRaises(ValidationError):
            ConflictListPatch(
                operations=[
                    {
                        "op": "update",
                        "index": 0,
                        "path": "$.conflicts[0]",
                        "updates": {"description": "x"},
                    }
                ]
            )
