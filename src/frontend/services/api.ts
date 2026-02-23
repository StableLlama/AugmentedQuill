// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines the api unit so this responsibility stays isolated, testable, and easy to evolve.
 */

import { machineApi } from './apiClients/machine';
import { projectsApi } from './apiClients/projects';
import { booksApi } from './apiClients/books';
import { chaptersApi } from './apiClients/chapters';
import { storyApi } from './apiClients/story';
import { settingsApi } from './apiClients/settings';
import { chatApi } from './apiClients/chat';
import { sourcebookApi } from './apiClients/sourcebook';
import { debugApi } from './apiClients/debug';

export const api = {
  machine: machineApi,
  projects: projectsApi,
  books: booksApi,
  chapters: chaptersApi,
  story: storyApi,
  settings: settingsApi,
  chat: chatApi,
  sourcebook: sourcebookApi,
  debug: debugApi,
};
