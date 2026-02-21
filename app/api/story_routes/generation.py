from fastapi import APIRouter

from app.api.story_routes.generation_mutations import (
    router as generation_mutations_router,
)
from app.api.story_routes.generation_streaming import (
    router as generation_streaming_router,
)

router = APIRouter(tags=["Story"])
router.include_router(generation_mutations_router)
router.include_router(generation_streaming_router)
