# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the build backend unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import sys
import subprocess


def main():
    sep = os.pathsep

    # Determine if we are building onefile or onedir
    mode = "--onefile"
    name = "AugmentedQuill"
    if len(sys.argv) > 1 and sys.argv[1] == "onedir":
        mode = "--onedir"
        name = "run_app"

    cmd = [
        "pyinstaller",
        "--name",
        name,
        mode,
        "--add-data",
        f"static/dist{sep}static/dist",
        "--add-data",
        f"static/images{sep}static/images",
        "run_app.py",
    ]

    print(f"Running: {' '.join(cmd)}")
    subprocess.check_call(cmd)


if __name__ == "__main__":
    main()
