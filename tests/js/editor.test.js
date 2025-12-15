import { ShellView } from '../../static/js/editor.js';

// Mock dependencies
jest.mock('../../static/js/utils/utils.js', () => ({
  fetchJSON: jest.fn(),
  API: {
    loadStory: jest.fn(),
    loadProjects: jest.fn(),
    loadChat: jest.fn()
  }
}));

jest.mock('../../static/js/components/component.js', () => {
  return {
    Component: jest.fn().mockImplementation(function(element, initialState) {
      this.el = element;
      this._state = { ...initialState };
      this._bindings = new Map();
      this._refs = {};
      // Define reactive properties
      Object.keys(initialState).forEach(key => {
        Object.defineProperty(this, key, {
          get: () => this._state[key],
          set: (value) => { this._state[key] = value; },
          enumerable: true
        });
      });
      this.watch = jest.fn();
      this.destroy = jest.fn();
      this._defineReactive = jest.fn((key, value) => {
        this._state[key] = value;
        Object.defineProperty(this, key, {
          get: () => this._state[key],
          set: (val) => { this._state[key] = val; },
          enumerable: true
        });
      });
    })
  };
});
jest.mock('../../static/js/renderers/chapterRenderer.js');
jest.mock('../../static/js/renderers/contentEditor.js');
jest.mock('../../static/js/actions/storyActions.js');
jest.mock('../../static/js/modes/flowMode.js');
jest.mock('../../static/js/managers/chapterManager.js');
jest.mock('../../static/js/managers/editorEvents.js');
jest.mock('../../static/js/managers/contentOperations.js');
jest.mock('../../static/js/managers/renderingManager.js');
jest.mock('../../static/js/managers/stateManager.js');
jest.mock('../../static/js/utils/editorUtils.js', () => ({
  debounce: jest.fn((fn) => fn),
  toast: jest.fn()
}));
jest.mock('../../static/js/constants/editorConstants.js', () => ({
  RENDER_MODES: {
    RAW: 'raw',
    MARKDOWN: 'markdown',
    WYSIWYG: 'wysiwyg'
  },
  EVENTS: {
    PROJECT_SELECTED: 'project-selected',
    STORY_UPDATED: 'story-updated',
    MACHINE_UPDATED: 'machine-updated'
  },
  DEFAULTS: {
    CONTENT_WIDTH: 50,
    FONT_SIZE: 1.0,
    DEBOUNCE_SUMMARY: 1000,
    DEBOUNCE_TITLE: 500
  },
  UI_STRINGS: {
    SAVED: 'Saved',
    FAILED_SAVE: 'Failed to save',
    ERROR_LOADING: 'Error loading chapter'
  }
}));

describe('ShellView', () => {
  let element;
  let shellView;

  beforeEach(() => {
    // Mock DOM element
    element = document.createElement('div');
    element.innerHTML = `
      <div data-chapter-list></div>
      <div data-ref="rawEditor"></div>
    `;
    document.body.appendChild(element);

    // Mock localStorage
    global.localStorage = {
      getItem: jest.fn(),
      setItem: jest.fn()
    };

    shellView = new ShellView(element);
  });

  afterEach(() => {
    document.body.removeChild(element);
    jest.clearAllMocks();
  });

  test('initializes with correct default state', () => {
    expect(shellView.chapters).toEqual([]);
    expect(shellView.activeId).toBeNull();
    expect(shellView.content).toBe('');
    expect(shellView.renderMode).toBe('raw');
    expect(shellView.dirty).toBe(false);
  });

  test('_confirmDiscardIfDirty returns true when not dirty', () => {
    shellView.dirty = false;
    expect(shellView._confirmDiscardIfDirty()).toBe(true);
  });

  test('_confirmDiscardIfDirty prompts when dirty', () => {
    shellView.dirty = true;
    global.confirm = jest.fn(() => true);
    expect(shellView._confirmDiscardIfDirty()).toBe(true);
    expect(global.confirm).toHaveBeenCalled();
  });

  test('onChanged marks content as dirty', () => {
    shellView._originalContent = 'original';
    shellView.content = 'changed';
    shellView.onChanged();
    expect(shellView.dirty).toBe(true);
  });

  test('getRawEl returns the raw editor element', () => {
    const rawEl = shellView.getRawEl();
    expect(rawEl).toBe(element.querySelector('[data-ref="rawEditor"]'));
  });
});