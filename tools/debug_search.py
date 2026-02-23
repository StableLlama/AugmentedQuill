# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the debug search unit so this responsibility stays isolated, testable, and easy to evolve."""

from duckduckgo_search import DDGS
import json
import sys


def test_search(q):
    print(f"Searching for: {q}")
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(q, max_results=5, region="wt-wt"))
            if not results:
                print("Retry with us-en...")
                results = list(ddgs.text(q, max_results=5, region="us-en"))
            print(f"Results count: {len(results)}")
            print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    query = (
        sys.argv[1] if len(sys.argv) > 1 else "current president of the United States"
    )
    test_search(query)
