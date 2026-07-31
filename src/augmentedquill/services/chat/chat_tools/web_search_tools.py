# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the web search tools unit so this responsibility stays isolated, testable, and easy to evolve."""

import asyncio
from typing import Any

from pydantic import Field

from augmentedquill.services.chat.chat_tool_decorator import (
    CHAT_ROLE,
    ToolModel,
    chat_tool,
)


class WebSearchParams(ToolModel):
    """Parameters for web_search tool."""

    query: str = Field(..., description="The search query.")


class VisitPageParams(ToolModel):
    """Parameters for visit_page tool."""

    url: str = Field(..., description="The URL of the page to visit.")


class WikipediaSearchParams(ToolModel):
    """Parameters for wikipedia_search tool."""

    query: str = Field(..., description="The search term.")


@chat_tool(
    description=(
        "Search the web for real-world information. "
        "NOTE: This returns snippets only. You MUST subsequently call 'visit_page' "
        "on the top 1-3 relevant URLs to get the actual content needed for your answer."
    ),
    allowed_roles=(CHAT_ROLE,),
    capability="web-search",
    opt_in=True,
)
async def web_search(params: WebSearchParams, payload: dict, mutations: dict) -> Any:
    """Execute a web search and return results."""
    query = params.query
    try:
        from ddgs import DDGS

        def _run_search() -> Any:
            """Helper for search.."""
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=8))
                if not results:
                    results = list(ddgs.news(query, max_results=5))
                return results

        results = await asyncio.to_thread(_run_search)
        return {"query": query, "results": results}
    except Exception as e:
        return {"query": query, "error": str(e), "results": []}


@chat_tool(
    description="Visit a specific web page by URL and extract its main content as text.",
    allowed_roles=(CHAT_ROLE,),
    capability="web-search",
    opt_in=True,
)
async def visit_page(params: VisitPageParams, payload: dict, mutations: dict) -> Any:
    """Fetch a web page and return its text content (max 10 000 chars)."""
    url = params.url
    try:
        import httpx
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        }
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, headers=headers, timeout=15.0)
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()
        lines = (line.strip() for line in soup.get_text(separator="\n").splitlines())
        text = "\n".join(chunk for line in lines for chunk in line.split("  ") if chunk)
        if len(text) > 10000:
            text = text[:10000] + "... [TRUNCATED]"
        return {"url": url, "content": text}
    except Exception as e:
        return {"url": url, "error": str(e)}


@chat_tool(
    description=(
        "Search Wikipedia for factual information. "
        "You MUST subsequently call 'visit_page' on the result URLs to read the full article content."
    ),
    allowed_roles=(CHAT_ROLE,),
    capability="web-search",
    opt_in=True,
)
async def wikipedia_search(
    params: WikipediaSearchParams, payload: dict, mutations: dict
) -> Any:
    """Query the Wikipedia opensearch API and return matching article titles and URLs."""
    query = params.query
    try:
        import httpx

        wiki_url = (
            f"https://en.wikipedia.org/w/api.php"
            f"?action=opensearch&search={query}&limit=5&namespace=0&format=json"
        )
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                wiki_url,
                headers={"User-Agent": "AugmentedQuill/1.0 (Research Tool)"},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()

        results = []
        if len(data) >= 4:
            for i in range(len(data[1])):
                results.append(
                    {"title": data[1][i], "snippet": data[2][i], "url": data[3][i]}
                )
        return {"query": query, "results": results}
    except Exception as e:
        return {"query": query, "error": str(e), "results": []}
