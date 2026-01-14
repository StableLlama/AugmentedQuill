#!/usr/bin/env python3
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

import os
import sys


def check_copyright(directory):
    extensions = {".py", ".ts", ".tsx", ".js"}
    ignore_dirs = {
        "venv",
        "node_modules",
        "__pycache__",
        ".git",
        "dist",
        "build",
        "AugmentedQuill.egg-info",
    }

    missing_copyright = []

    for root, dirs, files in os.walk(directory):
        # Filter directories
        dirs[:] = [d for d in dirs if d not in ignore_dirs]

        for file in files:
            ext = os.path.splitext(file)[1]
            if ext in extensions:
                path = os.path.join(root, file)

                # Check for empty file or specific test files that might not need it (optional)
                # But request said "all files".

                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read(500)  # Check first 500 chars
                        if "Copyright (C)" not in content:
                            missing_copyright.append(path)
                except Exception as e:
                    print(f"Error reading {path}: {e}")

    return missing_copyright


if __name__ == "__main__":
    if len(sys.argv) > 1:
        root_dir = sys.argv[1]
    else:
        root_dir = os.getcwd()

    print(f"Checking for copyright notices in {root_dir}...")
    missing = check_copyright(root_dir)

    if missing:
        print("\nMissing Copyright Notice in:")
        for f in missing:
            print(f"  {os.path.relpath(f, root_dir)}")
        sys.exit(1)
    else:
        print("All checks passed.")
        sys.exit(0)
