# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import asyncio
from unittest.mock import MagicMock, AsyncMock


async def test_mocking():
    # Setup
    MockClientClass = MagicMock()

    mock_client_instance = MagicMock()
    MockClientClass.return_value = mock_client_instance

    mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
    mock_client_instance.__aexit__ = AsyncMock()

    mock_stream_ctx = MagicMock()
    mock_response = MagicMock(name="response")
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
    mock_stream_ctx.__aexit__ = AsyncMock()

    mock_client_instance.stream.return_value = mock_stream_ctx

    # Test logic mimicking app code
    print("Entering client context...")
    async with MockClientClass() as client:
        print(f"Client obtained: {client}")
        print("Entering stream context...")
        async with client.stream("POST", "url") as resp:
            print(f"Response obtained: {resp}")
            if resp == mock_response:
                print("SUCCESS: mock_response matched")
            else:
                print("FAILURE: mismatch")


if __name__ == "__main__":
    asyncio.run(test_mocking())
