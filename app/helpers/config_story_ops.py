from __future__ import annotations

from typing import Any, Callable, Dict

import jsonschema


def normalize_validate_story_config(
    *,
    merged: Dict[str, Any],
    path_label: str,
    current_schema_version: int,
    schema_loader: Callable[[int], Dict[str, Any]],
) -> Dict[str, Any]:
    metadata = merged.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    version = metadata.get("version")
    if not isinstance(version, int) or version < current_schema_version:
        metadata["version"] = current_schema_version
    elif version > current_schema_version:
        raise ValueError(
            f"Story config at {path_label} has unknown version {version}. Current supported version is {current_schema_version}."
        )
    merged["metadata"] = metadata

    if not isinstance(merged.get("project_title"), str):
        merged["project_title"] = str(merged.get("project_title") or "")
    if not merged.get("format"):
        merged["format"] = "markdown"

    if not isinstance(merged.get("project_type"), str):
        if isinstance(merged.get("books"), list) and merged.get("books"):
            merged["project_type"] = "series"
        elif isinstance(merged.get("chapters"), list):
            merged["project_type"] = "novel"
        else:
            merged["project_type"] = "novel"

    sourcebook = merged.get("sourcebook")
    if isinstance(sourcebook, list):
        sourcebook_dict: Dict[str, Any] = {}
        for entry in sourcebook:
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                name = entry["name"]
                sourcebook_dict[name] = {
                    k: v for k, v in entry.items() if k not in ("id", "name")
                }
        merged["sourcebook"] = sourcebook_dict
    elif not isinstance(sourcebook, dict):
        merged["sourcebook"] = {}

    chapters = merged.get("chapters")
    if isinstance(chapters, list):
        for idx, chapter in enumerate(chapters, start=1):
            if isinstance(chapter, dict) and not chapter.get("title"):
                chapter["title"] = f"Chapter {idx}"
            if isinstance(chapter, dict) and isinstance(chapter.get("conflicts"), list):
                for conflict in chapter["conflicts"]:
                    if isinstance(conflict, dict) and "resolution" not in conflict:
                        conflict["resolution"] = ""

    books = merged.get("books")
    if isinstance(books, list):
        for book_idx, book in enumerate(books, start=1):
            if not isinstance(book, dict):
                continue
            if not book.get("title"):
                book["title"] = f"Book {book_idx}"
            bchapters = book.get("chapters")
            if not isinstance(bchapters, list):
                bchapters = []
                book["chapters"] = bchapters
            for chap_idx, chapter in enumerate(bchapters, start=1):
                if isinstance(chapter, dict) and not chapter.get("title"):
                    chapter["title"] = f"Chapter {chap_idx}"
                if isinstance(chapter, dict) and isinstance(
                    chapter.get("conflicts"), list
                ):
                    for conflict in chapter["conflicts"]:
                        if isinstance(conflict, dict) and "resolution" not in conflict:
                            conflict["resolution"] = ""

    version = merged.get("metadata", {}).get("version", current_schema_version)
    schema = schema_loader(version)
    try:
        jsonschema.validate(merged, schema)
    except jsonschema.ValidationError as exc:
        raise ValueError(f"Invalid story config at {path_label}: {exc.message}")

    if "tags" in merged and not isinstance(merged["tags"], list):
        raise ValueError(
            f"Invalid story config at {path_label}: 'tags' must be an array"
        )

    if merged.get("project_type") == "series" and "books" in merged:
        for book in merged["books"]:
            if isinstance(book, dict):
                if "id" in book and "folder" not in book:
                    book["folder"] = book["id"]
                if "folder" in book and "id" not in book:
                    book["id"] = book["folder"]

    return merged


def clean_story_config_for_disk(config: Dict[str, Any]) -> Dict[str, Any]:
    def _clean_for_disk(data, current_key=None):
        if isinstance(data, dict):
            res = {}
            for k, v in data.items():
                if k == "id":
                    continue
                if current_key == "sourcebook":
                    entry_data = _clean_for_disk(v)
                    if isinstance(entry_data, dict):
                        entry_data.pop("name", None)
                    res[k] = entry_data
                else:
                    res[k] = _clean_for_disk(v, k)
            return res
        if isinstance(data, list):
            if current_key == "sourcebook":
                res = {}
                for entry in data:
                    if isinstance(entry, dict) and "name" in entry:
                        name = entry["name"]
                        entry_copy = {
                            k: _clean_for_disk(v)
                            for k, v in entry.items()
                            if k not in ("id", "name")
                        }
                        res[name] = entry_copy
                return res
            return [_clean_for_disk(x) for x in data]
        return data

    return _clean_for_disk(config)
