/**
 * Lightweight reactive component base class
 * Vanilla JavaScript reactivity to maintain control over state management
 * and avoid external dependencies, ensuring consistent behavior across different environments.
 */
export class Component {
  constructor(element, initialState = {}) {
    this.el = element;
    this._state = {};
    this._computedCache = new Map();
    this._bindings = new Map();
    this._refs = {};

    // Initialize state with reactivity
    Object.keys(initialState).forEach(key => {
      this._defineReactive(key, initialState[key]);
    });

    // Scan for refs
    this._scanRefs();
  }

  /**
   * Define a reactive property
   */
  _defineReactive(key, initialValue) {
    this._state[key] = initialValue;

    Object.defineProperty(this, key, {
      get() {
        return this._state[key];
      },
      set(newValue) {
        if (this._state[key] !== newValue) {
          this._state[key] = newValue;
          this._notify(key);
        }
      },
      enumerable: true,
      configurable: true
    });
  }

  /**
   * Notify bindings when a property changes
   */
  _notify(key) {
    const bindings = this._bindings.get(key);
    if (bindings) {
      bindings.forEach(callback => callback(this._state[key]));
    }
  }

  /**
   * Bind a callback to property changes
   */
  watch(key, callback) {
    if (!this._bindings.has(key)) {
      this._bindings.set(key, new Set());
    }
    this._bindings.get(key).add(callback);
  }

  /**
   * Scan element for data-ref attributes
   */
  _scanRefs() {
    if (!this.el) return;

    const refElements = this.el.querySelectorAll('[data-ref]');
    refElements.forEach(el => {
      const refName = el.getAttribute('data-ref');
      if (refName) {
        this._refs[refName] = el;
      }
    });
  }

  /**
   * Get reference to element by ref name
   */
  get $refs() {
    return this._refs;
  }

  /**
   * Update DOM to reflect current state
   */
  render() {
    // Override in subclasses
  }

  /**
   * Initialize component (override in subclasses)
   */
  init() {
    // Override in subclasses
  }

  /**
   * Destroy component and clean up
   */
  destroy() {
    this._bindings.clear();
    this._computedCache.clear();
    this._refs = {};
  }
}

/**
 * Component registry for managing instances
 */
export class ComponentRegistry {
  constructor() {
    this.components = new Map();
  }

  /**
   * Register a component instance
   */
  register(name, component) {
    this.components.set(name, component);
  }

  /**
   * Get a component by name
   */
  get(name) {
    return this.components.get(name);
  }

  /**
   * Initialize all components on page
   */
  initAll() {
    this.components.forEach(component => {
      if (typeof component.init === 'function') {
        component.init();
      }
    });
  }

  /**
   * Destroy all components
   */
  destroyAll() {
    this.components.forEach(component => {
      if (typeof component.destroy === 'function') {
        component.destroy();
      }
    });
    this.components.clear();
  }
}

// Global registry instance
export const registry = new ComponentRegistry();
