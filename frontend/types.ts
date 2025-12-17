export interface Chapter {
  id: string;
  title: string;
  summary: string;
  content: string;
}

export interface Story {
  title: string;
  summary: string;
  styleTags: string[];
  chapters: Chapter[];
}

export interface StoryState extends Story {
  id: string; // Added ID for project management
  currentChapterId: string | null;
  lastUpdated?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  isError?: boolean;
}

export type ViewMode = 'raw' | 'markdown' | 'wysiwyg';

export type AppTheme = 'light' | 'mixed' | 'dark';

export interface EditorSettings {
  fontSize: number;
  maxWidth: number;
  brightness: number; // 0.5 - 1.0
  contrast: number; // 0.5 - 1.0
  theme: AppTheme;
}

export interface LLMConfig {
  id: string;
  name: string;
  provider: 'gemini' | 'openai';
  baseUrl: string;
  apiKey: string;
  timeout: number;
  modelId: string;
  temperature?: number;
  topP?: number;
  prompts: {
    system: string;
    continuation: string;
    summary: string;
  };
}

export interface AppSettings {
  providers: LLMConfig[];
  activeStoryProviderId: string;
  activeChatProviderId: string;
}

export interface ProjectMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

// Tool definitions for Gemini
export const TOOLS = [
  {
    name: 'update_chapter_content',
    description: 'Update the text content of the currently selected chapter. Use this when the user asks to write, rewrite, or edit the story text.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: {
          type: 'STRING',
          description: 'The full new content for the chapter.',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'create_chapter',
    description: 'Create a new chapter in the story.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'The title of the new chapter.',
        },
        summary: {
            type: 'STRING',
            description: 'A brief summary of what happens in this chapter.',
        }
      },
      required: ['title'],
    },
  },
  {
      name: 'update_chapter_summary',
      description: 'Update the summary of the current chapter.',
      parameters: {
          type: 'OBJECT',
          properties: {
              summary: {
                  type: 'STRING',
                  description: 'The new summary of the chapter.'
              }
          },
          required: ['summary']
      }
  }
];