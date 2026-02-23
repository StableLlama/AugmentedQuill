# Copyright (C) 2026 StableLlama
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Defines the run app unit so this responsibility stays isolated, testable, and easy to evolve."""

import os
import sys
import time
import threading
import webbrowser
import uvicorn
from augmentedquill.main import create_app


def open_browser(port):
    """Wait a moment for the server to start, then open the browser."""
    time.sleep(1.5)
    webbrowser.open(f"http://127.0.0.1:{port}")


def main():
    # Determine if we are running in a PyInstaller bundle
    if getattr(sys, "frozen", False):
        # If bundled, the base path is sys._MEIPASS
        # Change working directory to the directory containing the executable
        # so that data/ and resources/ are created next to the executable
        # UNLESS we are told not to (e.g. by Electron)
        if "--no-chdir" not in sys.argv:
            os.chdir(os.path.dirname(sys.executable))

    # Ensure necessary directories exist
    os.makedirs("data/projects", exist_ok=True)
    os.makedirs("data/logs", exist_ok=True)
    os.makedirs("resources/config", exist_ok=True)

    port = 8000

    # Start a thread to open the browser unless disabled
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()

    # Run the FastAPI app
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
