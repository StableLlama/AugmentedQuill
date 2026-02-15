from __future__ import annotations

from fastapi import HTTPException

from app.projects import (
    get_active_project_dir,
    list_chats,
    load_chat,
    save_chat,
    delete_chat,
    delete_all_chats,
)


def list_active_chats():
    project_dir = get_active_project_dir()
    if not project_dir:
        return []
    return list_chats(project_dir)


def load_active_chat(chat_id: str):
    project_dir = get_active_project_dir()
    if not project_dir:
        raise HTTPException(status_code=404, detail="No active project")
    data = load_chat(project_dir, chat_id)
    if not data:
        raise HTTPException(status_code=404, detail="Chat not found")
    return data


def save_active_chat(chat_id: str, data: dict):
    project_dir = get_active_project_dir()
    if not project_dir:
        raise HTTPException(status_code=404, detail="No active project")
    payload = dict(data)
    payload["id"] = chat_id
    save_chat(project_dir, chat_id, payload)


def delete_active_chat(chat_id: str):
    project_dir = get_active_project_dir()
    if not project_dir:
        raise HTTPException(status_code=404, detail="No active project")
    if delete_chat(project_dir, chat_id):
        return
    raise HTTPException(status_code=404, detail="Chat not found")


def delete_all_active_chats():
    project_dir = get_active_project_dir()
    if not project_dir:
        raise HTTPException(status_code=404, detail="No active project")
    delete_all_chats(project_dir)
