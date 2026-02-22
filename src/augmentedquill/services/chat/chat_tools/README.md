# Chat Tools

This directory contains LLM function calling tool implementations using a **decorator-based architecture**.

## Quick Start: Adding a New Tool

1. **Choose the appropriate domain file** (or create a new one):
   - `project_tools.py` - Project lifecycle (create, delete, list projects)
   - `story_tools.py` - Story metadata and content
   - `chapter_tools.py` - Chapter operations
   - `sourcebook_tools.py` - Sourcebook/wiki management
   - `image_tools.py` - Image management
   - `order_tools.py` - Reordering operations

2. **Define a Pydantic model for parameters**:

```python
from pydantic import BaseModel, Field

class MyToolParams(BaseModel):
    """Parameters for my_tool."""
    name: str = Field(..., description="The name parameter")
    count: int | None = Field(None, description="Optional count parameter")
```

3. **Implement the tool with the @chat_tool decorator**:

```python
from augmentedquill.services.chat.chat_tool_decorator import chat_tool

@chat_tool(
    name="my_tool",  # Optional: defaults to function name
    description="Brief description of what the tool does (shown to LLM)."
)
async def my_tool(params: MyToolParams, payload: dict, mutations: dict):
    """
    Implementation of my_tool.

    Args:
        params: Validated parameters from the LLM (auto-validated by Pydantic)
        payload: Additional context from the API request
        mutations: Dict for tracking changes (e.g., mutations["story_changed"] = True)

    Returns:
        dict: Result data (auto-wrapped in tool message format)
    """
    result = do_something(params.name, params.count)

    # Mark if changes were made
    if result.get("modified"):
        mutations["story_changed"] = True

    return {"result": result}  # Will be wrapped as {"role": "tool", ...}
```

4. **That's it!** The tool is automatically:
   - ✅ Registered in the global tool registry
   - ✅ Schema extracted from Pydantic model
   - ✅ Made available to the LLM
   - ✅ Parameters validated on each call

## Architecture

### Flow

1. **Import time**: Decorators run and register tools in `chat_tool_decorator._TOOL_REGISTRY`
2. **Schema collection**: `chat_tools_schema.py` collects schemas via `get_tool_schemas()`
3. **LLM API call**: Schemas sent to LLM as available functions
4. **Tool execution**: LLM returns tool calls, dispatcher routes to registered function
5. **Validation**: Pydantic validates parameters before calling your function
6. **Response**: Your return dict is wrapped and sent back to LLM

### Key Files

- **`chat_tool_decorator.py`**: Core decorator and registry implementation
- **`chat_tool_dispatcher.py`**: Central dispatcher for routing tool calls
- **`chat_tools_schema.py`**: Schema collection and export
- **`common.py`**: Shared utilities (tool_message, tool_error)

## Migration Notes

This decorator-based approach replaces the legacy pattern where:

- Schemas were manually defined in `chat_tools_schema.py`
- Implementations were in `handle_<domain>_tool()` functions
- Registry was manually maintained in `chat_tool_dispatcher.py`

**Current Status**:

- ✅ **Migrated**: Project tools (7 tools)
- ⏳ **Legacy**: Story, chapter, sourcebook, image, order tools

Once all tools are migrated, legacy code will be removed.

## Benefits

| Feature         | Decorator-Based      | Legacy Manual     |
| --------------- | -------------------- | ----------------- |
| Schema location | Co-located with code | Separate file     |
| Type safety     | Pydantic validation  | Manual parsing    |
| Registration    | Automatic            | Manual registry   |
| Maintenance     | Single edit          | 3 files to update |
| IDE support     | Full type hints      | Limited           |

## Examples

See `project_tools.py` for complete examples of the decorator-based approach.
