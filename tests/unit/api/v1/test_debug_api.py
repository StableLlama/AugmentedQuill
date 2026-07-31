# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Tests the debug API endpoints to prevent regression of dynamic log binding."""

from fastapi.testclient import TestClient

from augmentedquill.main import app
from augmentedquill.services.llm import llm_logging

client = TestClient(app)


def test_debug_llm_logs_dynamic_binding():
    """
    Ensure that the /api/v1/debug/llm_logs endpoint returns real-time
    contents of the llm_logging.llm_logs list.
    """
    # Clear logs before test
    llm_logging.llm_logs.clear()

    # Initial get should be empty
    response = client.get("/api/v1/debug/llm_logs")
    assert response.status_code == 200
    assert response.json()["logs"] == []

    # Modify the array directly (simulating real runtime logic)
    sample_log = {
        "id": "1",
        "timestamp_start": "2025-01-01T00:00:00Z",
        "timestamp_end": "2025-01-01T00:00:01Z",
        "request": {
            "url": "http://localhost/v1/chat/completions",
            "method": "POST",
            "headers": {},
            "body": {},
        },
        "response": None,
    }
    llm_logging.llm_logs.append(sample_log)

    # Subsequent GET should return the updated list
    response2 = client.get("/api/v1/debug/llm_logs")
    assert response2.status_code == 200
    assert len(response2.json()["logs"]) == 1
    assert response2.json()["logs"][0]["id"] == "1"

    # Test the DELETE endpoint
    response3 = client.delete("/api/v1/debug/llm_logs")
    assert response3.status_code == 200
    assert response3.json() == {"status": "ok"}

    # Final get should be empty again
    response4 = client.get("/api/v1/debug/llm_logs")
    assert response4.status_code == 200
    assert response4.json()["logs"] == []
