# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the projects unit so this responsibility stays isolated, testable, and easy to evolve.

"""
API endpoints for project-related operations including creation, deletion, and management.
"""

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import JSONResponse
from augmentedquill.services.projects.projects_api_manage_ops import (
    projects_listing_payload,
    delete_project_response,
    select_project_response,
    create_project_response,
    convert_project_response,
    create_book_response,
    delete_book_response,
)
from augmentedquill.services.projects.projects_api_asset_ops import (
    list_images_response,
    update_image_description_response,
    create_image_placeholder_response,
    upload_image_response,
    delete_image_response,
    get_image_file_response,
    export_project_response,
    import_project_response,
)

from augmentedquill.models.projects import (
    ProjectDeleteRequest,
    ProjectSelectRequest,
    ProjectCreateRequest,
    ProjectConvertRequest,
    BookCreateRequest,
    BookDeleteRequest,
    ImageDescriptionUpdateRequest,
    ImagePlaceholderRequest,
    ImageDeleteRequest,
    ProjectListResponse,
)

router = APIRouter(tags=["Projects"])


@router.get("/projects", response_model=ProjectListResponse)
async def api_projects() -> ProjectListResponse:
    return projects_listing_payload()


@router.post("/projects/delete")
async def api_projects_delete(body: ProjectDeleteRequest) -> JSONResponse:
    return delete_project_response(body.name)


@router.post("/projects/select")
async def api_projects_select(body: ProjectSelectRequest) -> JSONResponse:
    return select_project_response(body.name)


@router.post("/projects/create")
async def api_projects_create(body: ProjectCreateRequest) -> JSONResponse:
    return create_project_response(body.name, body.type)


@router.post("/projects/convert")
async def api_projects_convert(body: ProjectConvertRequest) -> JSONResponse:
    return convert_project_response(body.target_type)


@router.post("/books/create")
async def api_books_create(body: BookCreateRequest) -> JSONResponse:
    return create_book_response(body.name)


@router.post("/books/delete")
async def api_books_delete(body: BookDeleteRequest) -> JSONResponse:
    return delete_book_response(body.name)


@router.get("/projects/images/list")
async def api_list_images() -> JSONResponse:
    return list_images_response()


@router.post("/projects/images/update_description")
async def api_update_image_description(
    body: ImageDescriptionUpdateRequest,
) -> JSONResponse:
    return update_image_description_response(body.model_dump())


@router.post("/projects/images/create_placeholder")
async def api_create_image_placeholder(body: ImagePlaceholderRequest) -> JSONResponse:
    return create_image_placeholder_response(body.model_dump())


@router.post("/projects/images/upload")
async def api_upload_image(
    file: UploadFile = File(...), target_name: str | None = None
) -> JSONResponse:
    return await upload_image_response(file=file, target_name=target_name)


@router.post("/projects/images/delete")
async def api_delete_image(body: ImageDeleteRequest) -> JSONResponse:
    return delete_image_response(body.model_dump())


@router.get("/projects/images/{filename}")
async def api_projects_get_image(filename: str):
    return get_image_file_response(filename)


@router.get("/projects/export")
async def api_projects_export(name: str = None):
    return export_project_response(name=name)


@router.post("/projects/import")
async def api_projects_import(file: UploadFile = File(...)):
    return await import_project_response(file)
