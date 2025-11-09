from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple
import os

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"
REGISTRY_PATH = Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json")))

def get_registry_path() -> Path:
    # Re-evaluate environment at call time to make tests able to redirect location
    return Path(os.getenv("AUGQ_PROJECTS_REGISTRY", str(CONFIG_DIR / "projects.json")))


@dataclass
class ProjectInfo:
    path: Path
    is_valid: bool
    reason: str = ""


def _now_iso() -> str:
    return datetime.now().isoformat()


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def load_registry() -> Dict:
    rp = get_registry_path()
    if not rp.exists():
        return {"current": "", "recent": []}
    try:
        data = json.loads(rp.read_text(encoding="utf-8"))
    except Exception:
        return {"current": "", "recent": []}
    cur = data.get("current") or ""
    recent = data.get("recent") or []
    if not isinstance(recent, list):
        recent = []
    # normalize to strings
    recent = [str(x) for x in recent if isinstance(x, (str, Path))]
    return {"current": str(cur) if isinstance(cur, (str, Path)) else "", "recent": recent}


def save_registry(current: str, recent: List[str]) -> None:
    rp = get_registry_path()
    _ensure_dir(rp.parent)
    # De-dup while preserving order
    seen = set()
    deduped: List[str] = []
    for p in [current] + recent:
        sp = str(p)
        if sp and sp not in seen:
            seen.add(sp)
            deduped.append(sp)
    # Cap to 5 (current should be first already)
    final_list = deduped[:5]
    payload = {"current": current, "recent": final_list}
    rp.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def set_active_project(path: Path) -> None:
    reg = load_registry()
    current = str(path)
    recent = [x for x in reg.get("recent", []) if x != current]
    save_registry(current, [current] + recent)


def get_active_project_dir() -> Path | None:
    reg = load_registry()
    cur = reg.get("current") or ""
    if cur:
        p = Path(cur)
        return p
    return None


def validate_project_dir(path: Path) -> ProjectInfo:
    """Validate that path is a project directory.

    A valid project directory contains:
    - story.json file in its root
    - a subdirectory ("chapters") that contains at least one .txt or .md file (optional: allow empty)

    If directory is empty, it's considered initializable (not valid yet).
    """
    if not path.exists():
        return ProjectInfo(path, is_valid=False, reason="does_not_exist")
    if not path.is_dir():
        return ProjectInfo(path, is_valid=False, reason="not_a_directory")

    entries = list(path.iterdir())
    if not entries:
        return ProjectInfo(path, is_valid=False, reason="empty")

    story_path = path / "story.json"
    chapters_dir = path / "chapters"
    if story_path.exists() and story_path.is_file() and chapters_dir.exists() and chapters_dir.is_dir():
        # Chapters may be empty; .txt/.md are valid
        has_txt_md = any((f.suffix.lower() in (".txt", ".md")) for f in chapters_dir.glob("**/*") if f.is_file())
        # Consider valid even if empty; the UI can add chapters later
        return ProjectInfo(path, is_valid=True, reason="ok" if has_txt_md else "ok_empty_chapters")
    return ProjectInfo(path, is_valid=False, reason="missing_files")


def initialize_project_dir(path: Path, project_title: str = "Untitled Project") -> None:
    """Create minimal project structure at the given path.

    Creates:
    - story.json
    - chapters/ (empty)
    """
    _ensure_dir(path)
    chapters_dir = path / "chapters"
    _ensure_dir(chapters_dir)
    story_path = path / "story.json"
    if not story_path.exists():
        payload = {
            "project_title": project_title,
            "chapters": [],
            "format": "markdown",
            "llm_prefs": {"temperature": 0.7, "max_tokens": 2048},
            "created_at": _now_iso(),
        }
        story_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def select_project(path_str: str) -> Tuple[bool, str]:
    """Select a project directory.

    Behavior:
    - If path does not exist or is an empty directory → create/initialize.
    - If it is a valid project directory → accept.
    - Otherwise → error.
    Returns (ok, message). On success updates registry current+recent.
    """
    if not path_str:
        return False, "Path is required"
    p = Path(path_str).expanduser()
    if not p.exists():
        # Create new project
        initialize_project_dir(p)
        set_active_project(p)
        return True, "Project created"
    if p.is_dir():
        info = validate_project_dir(p)
        if info.is_valid:
            set_active_project(p)
            return True, "Project loaded"
        if info.reason == "empty":
            initialize_project_dir(p)
            set_active_project(p)
            return True, "Project created"
        return False, "Selected path is not a valid project directory"
    return False, "Selected path is not a directory"
