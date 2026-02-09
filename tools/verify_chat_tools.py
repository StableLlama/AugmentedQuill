import json
import asyncio
from unittest.mock import MagicMock, patch
from pathlib import Path

# Mock necessary parts of the app
import sys
import types

# Ensure the project root is in sys.path
BASE_DIR = Path("../../AugmentedQuill").resolve()
sys.path.insert(0, str(BASE_DIR))

# Mock modules that might fail on import during script execution
mock_modules = [
    "app.main",
]

for mod in mock_modules:
    sys.modules[mod] = types.ModuleType(mod)

# Import the router and function after setting up paths
from app.api.chat import api_chat_stream  # noqa: E402


async def test_mock_chat_stream():
    # Mock request payload
    payload = {
        "messages": [{"role": "user", "content": "Help me with my story."}],
        "model_name": "qwen",
    }

    class MockRequest:
        async def json(self):
            return payload

    # Mock httpx response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.headers = {"content-type": "text/event-stream"}

    # SSE stream
    async def mock_aiter_lines():
        # Yield a tool call in native format
        chunk = {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "get_project_overview",
                                    "arguments": "{}",
                                },
                            }
                        ]
                    }
                }
            ]
        }
        yield f"data: {json.dumps(chunk)}"
        yield "data: [DONE]"

    mock_response.aiter_lines = mock_aiter_lines

    # Use patch to intercept httpx.AsyncClient.stream
    # Note: api_chat_stream uses httpx.AsyncClient as a context manager
    with patch("httpx.AsyncClient.stream") as mock_stream:
        # mock_stream is a context manager, so it needs to return an object with __aenter__ and __aexit__
        mock_stream.return_value.__aenter__.return_value = mock_response

        # Mock other dependencies in app.api.chat
        with (
            patch("app.api.chat._load_machine_config") as mock_load_config,
            patch("app.api.chat.load_story_config") as mock_load_story,
            patch("app.api.chat.get_active_project_dir") as mock_active_dir,
            patch("app.api.chat.load_model_prompt_overrides") as mock_overrides,
            patch("app.api.chat.get_system_message") as mock_sys_msg,
            patch("app.api.chat.create_log_entry") as mock_log_entry,
            patch("app.api.chat.add_llm_log"),
        ):

            mock_load_config.return_value = {
                "openai": {
                    "models": [
                        {"name": "qwen", "base_url": "http://mock", "model": "qwen-max"}
                    ],
                    "selected": "qwen",
                }
            }
            mock_load_story.return_value = {}
            mock_active_dir.return_value = Path("/tmp")
            mock_overrides.return_value = {}
            mock_sys_msg.return_value = "System prompt"
            mock_log_entry.return_value = {"response": {}}

            response = await api_chat_stream(MockRequest())

            print("--- RECEIVED FROM STREAM ---")
            async for chunk in response.body_iterator:
                if isinstance(chunk, bytes):
                    print(chunk.decode())
                else:
                    print(chunk)

            # Check what was sent to OpenAI (the body)
            if mock_stream.called:
                call_args = mock_stream.call_args
                sent_body = call_args.kwargs.get("json")
                print("\n--- SENT TO LLM ---")
                print(f"Model: {sent_body['model']}")
                print(f"Tool count: {len(sent_body.get('tools', []))}")

                # Check for hidden tools
                tool_names = [t["function"]["name"] for t in sent_body.get("tools", [])]
                hidden_names = [
                    "get_story_summary",
                    "get_story_tags",
                    "write_chapter_summary",
                ]
                found_hidden = [n for n in hidden_names if n in tool_names]
                print(f"Found hidden tools: {found_hidden}")
            else:
                print("\nError: httpx.stream was not called!")


if __name__ == "__main__":
    asyncio.run(test_mock_chat_stream())
