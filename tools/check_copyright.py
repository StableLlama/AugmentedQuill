#!/usr/bin/env python3
# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Purpose: Defines the check copyright unit so this responsibility stays isolated, testable, and easy to evolve.

import os
import sys
import re


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
    missing_purpose = []

    for root, dirs, files in os.walk(directory):
        # Skip generated/dependency folders to keep checks focused on maintained source.
        dirs[:] = [d for d in dirs if d not in ignore_dirs]

        for file in files:
            ext = os.path.splitext(file)[1]
            if ext in extensions:
                path = os.path.join(root, file)

                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read(1200)
                        if "Copyright (C)" not in content:
                            missing_copyright.append(path)

                        is_python = ext == ".py"
                        marker = "#" if is_python else "//"
                        purpose_re = re.compile(
                            rf"^\s*{re.escape(marker)}\s*Purpose:\s+.+$",
                            re.MULTILINE,
                        )
                        if not purpose_re.search(content):
                            missing_purpose.append(path)
                except Exception as e:
                    print(f"Error reading {path}: {e}")

    return missing_copyright, missing_purpose


if __name__ == "__main__":
    if len(sys.argv) > 1:
        root_dir = sys.argv[1]
    else:
        root_dir = os.getcwd()

    print(f"Checking for copyright notices in {root_dir}...")
    missing_copyright, missing_purpose = check_copyright(root_dir)

    if missing_copyright or missing_purpose:
        print("\nMissing Copyright Notice in:")
        for f in missing_copyright:
            print(f"  {os.path.relpath(f, root_dir)}")

        print("\nMissing Purpose Header in:")
        for f in missing_purpose:
            print(f"  {os.path.relpath(f, root_dir)}")
        sys.exit(1)
    else:
        print("All checks passed.")
        sys.exit(0)
