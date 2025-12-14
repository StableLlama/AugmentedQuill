from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from app.projects import load_registry, select_project, delete_project, list_projects, get_active_project_dir
from app.config import load_story_config

router = APIRouter()


@router.get("/api/projects")
async def api_projects() -> dict:
    reg = load_registry()
    cur = reg.get("current") or ""
    recent = [p for p in reg.get("recent", []) if p]
    available = list_projects()
    return {"current": cur, "recent": recent[:5], "available": available}


@router.post("/api/projects/delete")
async def api_projects_delete(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = delete_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # Return updated registry and available list
    reg = load_registry()
    available = list_projects()
    return JSONResponse(status_code=200, content={"ok": True, "message": msg, "registry": reg, "available": available})


@router.post("/api/projects/select")
async def api_projects_select(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    name = (payload or {}).get("name") or ""
    ok, msg = select_project(name)
    if not ok:
        return JSONResponse(status_code=400, content={"ok": False, "detail": msg})
    # On success, return current registry and the story that was loaded/created
    reg = load_registry()
    active = get_active_project_dir()
    story = load_story_config((active / "story.json") if active else None)
    return JSONResponse(status_code=200, content={"ok": True, "message": msg, "registry": reg, "story": story})