export const RENDER_MODES = {
  RAW: 'raw',
  MARKDOWN: 'markdown',
  WYSIWYG: 'wysiwyg'
};

export const STORY_ACTIONS = {
  SUMMARY: 'summary',
  WRITE: 'write',
  CONTINUE: 'continue'
};

export const EVENTS = {
  PROJECT_SELECTED: 'aq:project-selected',
  STORY_UPDATED: 'aq:story-updated',
  MACHINE_UPDATED: 'aq:machine-updated'
};

export const UI_STRINGS = {
  SAVE: 'Save',
  SAVE_DIRTY: 'Save *',
  NO_CHAPTERS: 'No chapters',
  UNTITLED: 'Untitled',
  ENTER_SUMMARY: 'Enter summary...',
  ERROR_LOADING: 'Error loading chapter: ',
  FAILED_SAVE: 'Failed to save: ',
  FAILED_SUMMARY: 'Failed to write summary: ',
  FAILED_WRITE: 'Failed to write chapter: ',
  FAILED_CONTINUE: 'Failed to continue chapter: ',
  SUMMARY_EXISTS: 'Summary already exists. OK = discard and write new; Cancel = update existing.',
  SAVED: 'Saved',
  LOADING: '…'
};

export const DEFAULTS = {
  CONTENT_WIDTH: 33, // em
  FONT_SIZE: 1, // rem
  WIDTH_STEP: 4, // em
  FONT_STEP: 0.1, // rem
  MIN_WIDTH: 25, // em
  MAX_WIDTH: 80, // em
  MIN_FONT: 0.7, // rem
  MAX_FONT: 2.0, // rem
  DEBOUNCE_SUMMARY: 1000, // ms
  DEBOUNCE_TITLE: 500, // ms
  TOAST_TIMEOUT: 2500 // ms
};