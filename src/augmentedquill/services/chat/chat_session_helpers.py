# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the chat session helpers unit so this responsibility stays isolated, testable, and easy to evolve.

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List


def _now_iso() -> str:
    return datetime.now().isoformat()


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def get_chats_dir(project_path: Path) -> Path:
    return project_path / "chats"


def list_chats(project_path: Path) -> List[Dict]:
    chats_dir = get_chats_dir(project_path)
    if not chats_dir.exists():
        return []

    results = []
    for file_path in chats_dir.glob("*.json"):
        if not file_path.is_file():
            continue
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            results.append(
                {
                    "id": data.get("id", file_path.stem),
                    "name": data.get("name", "Untitled Chat"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                }
            )
        except Exception:
            continue

    results.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    return results


def load_chat(project_path: Path, chat_id: str) -> Dict | None:
    chat_file = get_chats_dir(project_path) / f"{chat_id}.json"
    if not chat_file.exists():
        return None
    try:
        return json.loads(chat_file.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_chat(project_path: Path, chat_id: str, chat_data: Dict) -> None:
    chats_dir = get_chats_dir(project_path)
    _ensure_dir(chats_dir)
    chat_file = chats_dir / f"{chat_id}.json"
    chat_data["updated_at"] = _now_iso()
    if "created_at" not in chat_data:
        chat_data["created_at"] = chat_data["updated_at"]
    chat_file.write_text(json.dumps(chat_data, indent=2), encoding="utf-8")


def delete_chat(project_path: Path, chat_id: str) -> bool:
    chat_file = get_chats_dir(project_path) / f"{chat_id}.json"
    if not chat_file.exists():
        return False
    chat_file.unlink()
    return True


def delete_all_chats(project_path: Path) -> None:
    chats_dir = get_chats_dir(project_path)
    if chats_dir.exists():
        shutil.rmtree(chats_dir)
    chats_dir.mkdir(parents=True, exist_ok=True)
