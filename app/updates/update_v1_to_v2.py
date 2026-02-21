# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the update v1 to v2 unit so this responsibility stays isolated, testable, and easy to evolve.

"""
Update script for story.json from version 1 to 2.

This is a dummy update script that only changes the version number.
"""

import json
import sys
from typing import Dict, Any


def update_story_config_v1_to_v2(config: Dict[str, Any]) -> Dict[str, Any]:
    """Update a story config from version 1 to 2."""
    # For dummy update, just change the version
    if "metadata" in config and "version" in config["metadata"]:
        config["metadata"]["version"] = 2
    return config


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python update_v1_to_v2.py <config_file>")
        sys.exit(1)

    config_file = sys.argv[1]
    with open(config_file, "r") as f:
        config = json.load(f)

    updated_config = update_story_config_v1_to_v2(config)

    with open(config_file, "w") as f:
        json.dump(updated_config, f, indent=2)

    print(f"Updated {config_file} from version 1 to 2")
