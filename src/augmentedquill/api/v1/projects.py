# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve.

API endpoints for project-related operations including creation, deletion, and management.
"""

from typing import Annotated, Any

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from augmentedquill.models.projects import (
    BookCreateRequest,
    BookDeleteRequest,
    BookRestoreRequest,
    ImageDeleteRequest,
    ImageDescriptionUpdateRequest,
    ImagePlaceholderRequest,
    ImageRestoreRequest,
    ProjectConvertRequest,
    ProjectCreateRequest,
    ProjectDeleteRequest,
    ProjectListResponse,
    ProjectSelectRequest,
)
from augmentedquill.models.story import (
    BookMutationResponse,
    ListImagesResponse,
    ProjectImageInfo,
    ProjectMutationResponse,
    ProjectSelectResponse,
)
from augmentedquill.services.projects.export_epub import export_project_epub_response
from augmentedquill.services.projects.projects_api_asset_ops import (
    create_image_placeholder_response,
    delete_image_response,
    export_project_response,
    get_image_file_response,
    import_project_response,
    restore_image_response,
    update_image_description_response,
    upload_image_response,
)
from augmentedquill.services.projects.projects_api_manage_ops import (
    convert_project_response,
    create_book_response,
    create_project_response,
    delete_book_response,
    delete_project_response,
    projects_listing_payload,
    restore_book_response,
    select_project_response,
)
from augmentedquill.utils.image_helpers import get_project_images

router = APIRouter(tags=["Projects"])


@router.get("/projects", response_model=ProjectListResponse)
async def api_projects() -> ProjectListResponse:
    """Handle the API request to projects."""
    return projects_listing_payload()


@router.post("/projects/delete", response_model=ProjectMutationResponse)
async def api_projects_delete(body: ProjectDeleteRequest) -> ProjectMutationResponse:
    """Handle the API request to projects delete."""
    return delete_project_response(body.name)


@router.post("/projects/select", response_model=ProjectSelectResponse)
async def api_projects_select(body: ProjectSelectRequest) -> ProjectSelectResponse:
    """Handle the API request to projects select."""
    return select_project_response(body.name)


@router.post("/projects/create", response_model=ProjectMutationResponse)
async def api_projects_create(body: ProjectCreateRequest) -> ProjectMutationResponse:
    """Handle the API request to projects create."""
    # language is optional, default occurs downstream
    return create_project_response(body.name, body.type, body.language or "en")


@router.post("/projects/convert", response_model=ProjectMutationResponse)
async def api_projects_convert(body: ProjectConvertRequest) -> ProjectMutationResponse:
    """Handle the API request to projects convert."""
    return convert_project_response(body.target_type)


@router.post("/books/create", response_model=BookMutationResponse)
async def api_books_create(body: BookCreateRequest) -> BookMutationResponse:
    """Handle the API request to books create."""
    return create_book_response(body.name)


@router.post("/books/delete", response_model=BookMutationResponse)
async def api_books_delete(body: BookDeleteRequest) -> BookMutationResponse:
    """Handle the API request to books delete."""
    return delete_book_response(body.name)


@router.post("/books/restore", response_model=BookMutationResponse)
async def api_books_restore(body: BookRestoreRequest) -> BookMutationResponse:
    """Handle the API request to books restore."""
    return restore_book_response(body.restore_id)


@router.get("/projects/images/list", response_model=ListImagesResponse)
async def api_projects_images_list() -> ListImagesResponse:
    """Handle the API request to projects images list."""
    images = get_project_images()
    return ListImagesResponse(images=[ProjectImageInfo(**img) for img in images])


@router.post("/projects/images/update_description")
async def api_projects_images_update_description(
    body: ImageDescriptionUpdateRequest,
) -> JSONResponse:
    """Handle the API request to projects images update description."""
    return update_image_description_response(body.model_dump())


@router.post("/projects/images/create_placeholder")
async def api_projects_images_create_placeholder(
    body: ImagePlaceholderRequest,
) -> JSONResponse:
    """Handle the API request to projects images create placeholder."""
    return create_image_placeholder_response(body.model_dump())


@router.post("/projects/images/upload")
async def api_projects_images_upload(
    file: Annotated[UploadFile, File()], target_name: str | None = None
) -> JSONResponse:
    """Handle the API request to projects images upload."""
    return await upload_image_response(file=file, target_name=target_name)


@router.post("/projects/images/delete")
async def api_projects_images_delete(body: ImageDeleteRequest) -> JSONResponse:
    """Handle the API request to projects images delete."""
    return delete_image_response(body.model_dump())


@router.post("/projects/images/restore")
async def api_projects_images_restore(body: ImageRestoreRequest) -> JSONResponse:
    """Handle the API request to projects images restore."""
    return restore_image_response(body.model_dump())


@router.get("/projects/images/{filename}")
async def api_projects_images_get(filename: str) -> Any:
    """Handle the API request to projects images get."""
    return get_image_file_response(filename)


@router.get("/projects/export")
# The optional query param stays `str = None` so the exported OpenAPI schema
# keeps `name` as a plain (non-nullable) string, avoiding API contract churn.
async def api_projects_export(name: str = None) -> Any:  # noqa: RUF013
    """Handle the API request to projects export."""
    return export_project_response(name=name)


@router.get("/projects/export/epub")
async def api_projects_export_epub(name: str = None) -> Any:  # noqa: RUF013
    """Handle the API request to projects export epub."""
    return export_project_epub_response(name=name)


@router.post("/projects/import", response_model=ProjectMutationResponse)
async def api_projects_import(
    file: Annotated[UploadFile, File()],
) -> ProjectMutationResponse:
    """Handle the API request to projects import."""
    return await import_project_response(file)
