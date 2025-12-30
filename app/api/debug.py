from fastapi import APIRouter
from app.llm import llm_logs

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("/llm_logs")
async def get_llm_logs():
    """Return the list of LLM communication logs."""
    return llm_logs


@router.delete("/llm_logs")
async def clear_llm_logs():
    """Clear the LLM communication logs."""
    llm_logs.clear()
    return {"status": "ok"}
