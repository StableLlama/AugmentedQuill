// Tool definitions for AI assistant
// These tools enable the AI to interact with the story project,
// providing context-aware assistance by allowing access to chapter information and content.
// This makes the AI more helpful for writing and editing tasks.

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_project_overview',
      description: 'Get the project title and a list of chapters with id, filename, title, and summary.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_content',
      description: 'Get a slice of chapter content by id with start and max_chars bounds.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id (defaults to active chapter if omitted).' },
          start: { type: 'integer', default: 0 },
          max_chars: { type: 'integer', default: 2000 }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_chapter_content',
      description: 'Set the content of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' },
          content: { type: 'string', description: 'New content for the chapter.' }
        },
        required: ['chap_id', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_chapter_summary',
      description: 'Set the summary of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' },
          summary: { type: 'string', description: 'New summary for the chapter.' }
        },
        required: ['chap_id', 'summary'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sync_summary',
      description: 'Generate or update the summary for a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer' },
          mode: { type: 'string', enum: ['update', 'discard'], description: 'Discard existing and write new, or update.' }
        },
        required: ['chap_id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_story_summary',
      description: 'Get the overall story summary.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_story_summary',
      description: 'Set the overall story summary.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'New story summary.' }
        },
        required: ['summary'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_story_tags',
      description: 'Get the story tags that define the style.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_story_tags',
      description: 'Set the story tags that define the style.',
      parameters: {
        type: 'object',
        properties: {
          tags: { type: 'string', description: 'New tags for the story.' }
        },
        required: ['tags'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_new_chapter',
      description: 'Create a new chapter.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title for the new chapter.' }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_heading',
      description: 'Get the heading (title) of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' }
        },
        required: ['chap_id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_chapter_heading',
      description: 'Set the heading (title) of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' },
          heading: { type: 'string', description: 'New heading for the chapter.' }
        },
        required: ['chap_id', 'heading'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_chapter_summary',
      description: 'Get the summary of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' }
        },
        required: ['chap_id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_chapter',
      description: 'Generate chapter content from the chapter summary (replace existing content).',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' }
        },
        required: ['chap_id'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'continue_chapter',
      description: 'Continue the chapter content from its current text, guided by the summary.',
      parameters: { type: 'object', properties: { chap_id: { type: 'integer' } }, required: ['chap_id'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_chapter',
      description: 'Delete a chapter by its id.',
      parameters: {
        type: 'object',
        properties: {
          chap_id: { type: 'integer', description: 'Chapter numeric id.' }
        },
        required: ['chap_id'],
        additionalProperties: false
      }
    }
  }
];