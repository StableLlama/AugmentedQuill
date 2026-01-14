# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import json
from pathlib import Path
from app.projects import get_active_project_dir


def get_images_dir() -> Path | None:
    active = get_active_project_dir()
    if active:
        return active / "images"
    return None


def load_image_metadata() -> dict:
    d = get_images_dir()
    if not d:
        return {}
    meta_file = d / "metadata.json"
    if meta_file.exists():
        try:
            return json.loads(meta_file.read_text("utf-8"))
        except Exception:
            return {}
    return {}


def save_image_metadata(data: dict):
    d = get_images_dir()
    if d:
        d.mkdir(parents=True, exist_ok=True)
        (d / "metadata.json").write_text(json.dumps(data, indent=2), "utf-8")


def get_image_entry(filename: str) -> dict:
    meta = load_image_metadata()
    return meta.get(filename, {})


def update_image_metadata(filename: str, description: str = None, title: str = None):
    meta = load_image_metadata()
    if filename not in meta:
        meta[filename] = {}

    if description is not None:
        meta[filename]["description"] = description
    if title is not None:
        meta[filename]["title"] = title

    save_image_metadata(meta)


def delete_image_metadata(filename: str):
    meta = load_image_metadata()
    if filename in meta:
        del meta[filename]
        save_image_metadata(meta)


def get_project_images() -> list[dict]:
    active = get_active_project_dir()
    if not active:
        return []

    images_dir = active / "images"
    meta = load_image_metadata()

    files_map = {}
    if images_dir and images_dir.exists():
        for f in images_dir.iterdir():
            if (
                f.is_file()
                and f.suffix.lower()
                in (
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".gif",
                    ".webp",
                    ".svg",
                )
                and f.name != "metadata.json"
            ):
                files_map[f.name] = True

    images = []
    # Add existing files
    for fname in sorted(files_map.keys()):
        m = meta.get(fname, {})
        desc = m.get("description", "")
        title = m.get("title", fname)
        images.append(
            {
                "filename": fname,
                "url": f"/api/projects/images/{fname}",
                "description": desc,
                "title": title,
                "is_placeholder": False,
            }
        )

    # Add placeholders
    for fname in sorted(meta.keys()):
        if fname not in files_map:
            info = meta[fname]
            # Verify if it's meant to be a placeholder or just stale metadata?
            # Any metadata without a file is effectively a placeholder in this system.
            images.append(
                {
                    "filename": fname,
                    "url": None,
                    "description": info.get("description", ""),
                    "title": info.get("title", fname),
                    "is_placeholder": True,
                }
            )

    return images
