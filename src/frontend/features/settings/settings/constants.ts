// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// Purpose: Defines the constants unit so this responsibility stays isolated, testable, and easy to evolve.

export const PROMPT_GROUPS = [
  {
    title: 'System Messages',
    prompts: [
      { id: 'chat_llm', label: 'Chat Assistant', type: 'CHAT' },
      { id: 'editing_llm', label: 'Editing Assistant', type: 'EDITING' },
      { id: 'story_writer', label: 'Story Writer', type: 'WRITING' },
      { id: 'story_continuer', label: 'Story Continuer', type: 'WRITING' },
      {
        id: 'chapter_summarizer',
        label: 'Chapter Summarizer',
        type: 'EDITING',
      },
      { id: 'story_summarizer', label: 'Story Summarizer', type: 'EDITING' },
      {
        id: 'ai_action_summary_update',
        label: 'AI Action: Update Summary',
        type: 'EDITING',
      },
      {
        id: 'ai_action_summary_rewrite',
        label: 'AI Action: Rewrite Summary',
        type: 'EDITING',
      },
      {
        id: 'ai_action_chapter_extend',
        label: 'AI Action: Extend Chapter',
        type: 'WRITING',
      },
      {
        id: 'ai_action_chapter_rewrite',
        label: 'AI Action: Rewrite Chapter',
        type: 'WRITING',
      },
    ],
  },
  {
    title: 'User Prompts',
    prompts: [
      {
        id: 'chapter_summary_new',
        label: 'New Chapter Summary',
        type: 'EDITING',
      },
      {
        id: 'chapter_summary_update',
        label: 'Update Chapter Summary',
        type: 'EDITING',
      },
      { id: 'write_chapter', label: 'Write Chapter', type: 'WRITING' },
      { id: 'continue_chapter', label: 'Continue Chapter', type: 'WRITING' },
      { id: 'story_summary_new', label: 'New Story Summary', type: 'EDITING' },
      {
        id: 'story_summary_update',
        label: 'Update Story Summary',
        type: 'EDITING',
      },
      {
        id: 'suggest_continuation',
        label: 'Suggest Continuation (Autocomplete)',
        type: 'WRITING',
      },
      { id: 'chat_user_context', label: 'Chat User Context', type: 'CHAT' },
      {
        id: 'ai_action_summary_update_user',
        label: 'AI Action: Update Summary (User)',
        type: 'EDITING',
      },
      {
        id: 'ai_action_summary_rewrite_user',
        label: 'AI Action: Rewrite Summary (User)',
        type: 'EDITING',
      },
      {
        id: 'ai_action_chapter_extend_user',
        label: 'AI Action: Extend Chapter (User)',
        type: 'WRITING',
      },
      {
        id: 'ai_action_chapter_rewrite_user',
        label: 'AI Action: Rewrite Chapter (User)',
        type: 'WRITING',
      },
    ],
  },
];
