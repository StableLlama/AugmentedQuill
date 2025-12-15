import { Component } from '../../static/js/components/component.js';

describe('Component', () => {
  let element;
  let component;

  beforeEach(() => {
    // Create a mock DOM element
    element = document.createElement('div');
    element.innerHTML = `
      <input data-ref="testInput" value="test" />
      <div data-ref="testDiv">content</div>
    `;
    document.body.appendChild(element);

    component = new Component(element, {
      testProp: 'initial',
      count: 0
    });
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  test('initializes with correct state', () => {
    expect(component.testProp).toBe('initial');
    expect(component.count).toBe(0);
  });

  test('reactive properties notify watchers', () => {
    const mockCallback = jest.fn();
    component.watch('testProp', mockCallback);

    component.testProp = 'changed';
    expect(mockCallback).toHaveBeenCalledWith('changed');
  });

  test('scans and provides refs', () => {
    expect(component.$refs.testInput).toBe(element.querySelector('[data-ref="testInput"]'));
    expect(component.$refs.testDiv).toBe(element.querySelector('[data-ref="testDiv"]'));
  });

  test('destroy cleans up bindings and refs', () => {
    component.watch('testProp', () => {});
    expect(component._bindings.size).toBeGreaterThan(0);

    component.destroy();

    expect(component._bindings.size).toBe(0);
    expect(Object.keys(component._refs).length).toBe(0);
  });
});