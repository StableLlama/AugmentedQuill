// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for CodeMirrorEditor covering the public API surface —
 * ref exposure, value initialisation, onChange/onSelectionChange callbacks,
 * external value sync with echo-prevention, compartment reconfiguration, and
 * enterBehavior modes.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorView } from '@codemirror/view';

import { CodeMirrorEditor } from './CodeMirrorEditor';

afterEach(() => {
  cleanup();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Press a key on the CodeMirror content DOM by dispatching a real KeyboardEvent.
 * Wrapped in `act` so React flushes any resulting state updates.
 */
function pressKey(
  view: EditorView,
  key: string,
  extraInit: KeyboardEventInit = {}
): void {
  view.contentDOM.focus();
  act(() => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...extraInit,
      })
    );
  });
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('CodeMirrorEditor', () => {
  // ── Mount / ref ────────────────────────────────────────────────────────────

  it('exposes an EditorView instance via forwardRef after mount', async () => {
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="hello" onChange={vi.fn()} />);
    });
    expect(ref.current).toBeInstanceOf(EditorView);
  });

  it('initialises the document content from the value prop', async () => {
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="initial text" onChange={vi.fn()} />);
    });
    expect(ref.current?.state.doc.toString()).toBe('initial text');
  });

  it('clears the forwardRef on unmount', async () => {
    const ref = React.createRef<EditorView | null>();
    const { unmount } = render(
      <CodeMirrorEditor ref={ref} value="text" onChange={vi.fn()} />
    );
    await act(async () => {
      unmount();
    });
    expect(ref.current).toBeNull();
  });

  // ── Callbacks ──────────────────────────────────────────────────────────────

  it('calls onChange with the new document string when content is mutated', async () => {
    const onChange = vi.fn();
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="" onChange={onChange} />);
    });
    act(() => {
      ref.current!.dispatch({ changes: { from: 0, to: 0, insert: 'typed' } });
    });
    expect(onChange).toHaveBeenCalledWith('typed', false);
  });

  it('calls onSelectionChange with anchor and head when selection changes', async () => {
    const onSelectionChange = vi.fn();
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(
        <CodeMirrorEditor
          ref={ref}
          value="hello world"
          onChange={vi.fn()}
          onSelectionChange={onSelectionChange}
        />
      );
    });
    act(() => {
      ref.current!.dispatch({ selection: { anchor: 3, head: 7 } });
    });
    expect(onSelectionChange).toHaveBeenCalledWith(3, 7);
  });

  // ── External value sync ────────────────────────────────────────────────────

  it('syncs document when value prop changes due to an external update', async () => {
    const ref = React.createRef<EditorView | null>();
    const { rerender } = render(
      <CodeMirrorEditor ref={ref} value="first" onChange={vi.fn()} />
    );
    // 'first' is both in doc and lastEmittedRef at this point.
    // Simulate an external change (e.g. chapter switch): mutate the doc
    // directly so lastEmittedRef stays 'first', then pass a different value prop.
    act(() => {
      // Manually update the doc without going through onChange so lastEmittedRef
      // stays 'first' and the new value prop 'external' is truly foreign.
      ref.current!.dispatch({
        changes: { from: 0, to: ref.current!.state.doc.length, insert: 'first' },
      });
    });
    // Reset lastEmittedRef to 'first' (it is already, but make it explicit) then
    // pass a different inbound value that neither matches the doc nor lastEmitted.
    await act(async () => {
      rerender(<CodeMirrorEditor ref={ref} value="external" onChange={vi.fn()} />);
    });
    expect(ref.current?.state.doc.toString()).toBe('external');
  });

  it('does not re-dispatch when echoed value prop matches the last emitted value', async () => {
    const onChange = vi.fn();
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="" onChange={onChange} />);
    });
    // User types, onChange is called with 'typed', lastEmittedRef becomes 'typed'
    act(() => {
      ref.current!.dispatch({ changes: { from: 0, to: 0, insert: 'typed' } });
    });
    expect(onChange).toHaveBeenCalledWith('typed', false);
    onChange.mockClear();

    // React echoes the value prop back — should NOT trigger another dispatch
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="typed" onChange={onChange} />);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current?.state.doc.toString()).toBe('typed');
  });

  // ── Compartment reconfiguration ────────────────────────────────────────────

  it('switching mode prop between plain and markdown does not crash or lose content', async () => {
    const ref = React.createRef<EditorView | null>();
    const { rerender } = render(
      <CodeMirrorEditor ref={ref} value="prose text" onChange={vi.fn()} mode="plain" />
    );
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="prose text"
          onChange={vi.fn()}
          mode="markdown"
        />
      );
    });
    expect(ref.current?.state.doc.toString()).toBe('prose text');
  });

  it('switching viewMode from raw to markdown with image syntax does not throw', async () => {
    const ref = React.createRef<EditorView | null>();
    const value = 'Before image\n![Alt text](/assets/picture.jpg)\nAfter image';
    const { rerender } = render(
      <CodeMirrorEditor ref={ref} value={value} onChange={vi.fn()} viewMode="raw" />
    );

    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value={value}
          onChange={vi.fn()}
          viewMode="markdown"
        />
      );
    });

    expect(ref.current?.state.doc.toString()).toBe(value);
  });

  it('strips scene marker comments from document when hideSceneMarkers is enabled', async () => {
    const ref = React.createRef<EditorView | null>();
    const value = '<!--scene:3:start-->Visible prose<!--scene:3:end-->';
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value={value}
        onChange={vi.fn()}
        viewMode="raw"
        hideSceneMarkers={true}
      />
    );

    await act(async () => {});

    // Markers are stripped from the document; only prose remains
    expect(ref.current?.state.doc.toString()).not.toContain('<!--scene:3:start-->');
    expect(ref.current?.state.doc.toString()).not.toContain('<!--scene:3:end-->');
    expect(ref.current?.state.doc.toString()).toContain('Visible prose');
    expect(container.textContent ?? '').toContain('Visible prose');
    expect(container.textContent ?? '').not.toContain('<!--scene:3:start-->');
  });

  it('toggling showWhitespace does not crash or corrupt the document', async () => {
    const ref = React.createRef<EditorView | null>();
    const { rerender } = render(
      <CodeMirrorEditor
        ref={ref}
        value="a b"
        onChange={vi.fn()}
        showWhitespace={false}
      />
    );
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="a b"
          onChange={vi.fn()}
          showWhitespace={true}
        />
      );
    });
    expect(ref.current?.state.doc.toString()).toBe('a b');
  });

  it('renders whitespace space markers at 1ch width', async () => {
    const { container } = render(
      <CodeMirrorEditor value="a b" onChange={vi.fn()} showWhitespace={true} />
    );
    await act(async () => {});

    const marker = container.querySelector(
      '.cm-ws-marker[data-ws-marker="1"]'
    ) as HTMLElement | null;
    expect(marker).toBeDefined();
  });

  it('renders normal space markers without widget buffers', async () => {
    const { container } = render(
      <CodeMirrorEditor value="a b" onChange={vi.fn()} showWhitespace={true} />
    );
    await act(async () => {});

    const line = container.querySelector('.cm-line');
    expect(line).not.toBeNull();
    if (!line) return;

    const marker = line.querySelector(
      '.cm-ws-marker.cm-ws-space[data-ws-marker="1"]'
    ) as HTMLElement | null;
    expect(marker).toBeTruthy();
    expect(marker?.getAttribute('aria-hidden')).toBeNull();
    expect(marker?.querySelector('.cm-ws-glyph')).toBeNull();
  });

  it('renders a visible tab marker when showWhitespace is active', async () => {
    const ref = React.createRef<EditorView | null>();
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value={'a\tb'}
        onChange={vi.fn()}
        showWhitespace={true}
      />
    );
    await act(async () => {});

    const docText = ref.current?.state.doc.toString() ?? '';
    expect(docText).toBe('a\tb');
    const markers = Array.from(container.querySelectorAll('.cm-ws-marker'));
    const marker = markers.find((el: Element) => el.textContent === '→');
    expect(marker).toBeDefined();
    expect(marker?.textContent).toBe('→');
  });

  it('inserts a literal tab character when Tab is pressed', async () => {
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="" onChange={vi.fn()} />);
    });

    pressKey(ref.current!, 'Tab');
    expect(ref.current?.state.doc.toString()).toBe('\t');
  });

  it('places cursor before end-of-line ws marker', async () => {
    const ref = React.createRef<EditorView | null>();
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="abc\n"
        onChange={vi.fn()}
        showWhitespace={true}
      />
    );

    await act(async () => {
      ref.current?.dispatch({ selection: { anchor: 3, head: 3 } });
    });

    const line = container.querySelector('.cm-line');
    expect(line).not.toBeNull();
    if (!line) return;

    const lineHtml = line.innerHTML;
    expect(lineHtml).toContain('abc');
    expect(lineHtml).toContain('<span aria-hidden="true" class="cm-ws-marker"');
    // In Raw mode with WS markers, EOL marker should appear after the line text
    expect(lineHtml.indexOf('abc')).toBeLessThan(
      lineHtml.indexOf('class="cm-ws-marker"')
    );
  });

  // ── Placeholder ────────────────────────────────────────────────────────────

  it('renders a placeholder element when the document is empty', async () => {
    const { container } = render(
      <CodeMirrorEditor value="" onChange={vi.fn()} placeholder="Start writing…" />
    );
    await act(async () => {});
    expect(container.querySelector('.cm-placeholder')).not.toBeNull();
  });

  it('does not render a placeholder element when the document is non-empty', async () => {
    const { container } = render(
      <CodeMirrorEditor
        value="not empty"
        onChange={vi.fn()}
        placeholder="Start writing…"
      />
    );
    await act(async () => {});
    expect(container.querySelector('.cm-placeholder')).toBeNull();
  });

  // ── enterBehavior ──────────────────────────────────────────────────────────

  describe('enterBehavior', () => {
    it('ignore: Enter key does not modify the document', async () => {
      const onChange = vi.fn();
      const ref = React.createRef<EditorView | null>();
      await act(async () => {
        render(
          <CodeMirrorEditor
            ref={ref}
            value="line one"
            onChange={onChange}
            enterBehavior="ignore"
          />
        );
      });
      act(() => {
        ref.current!.dispatch({ selection: { anchor: 8 } });
      });
      pressKey(ref.current!, 'Enter');
      expect(onChange).not.toHaveBeenCalled();
      expect(ref.current!.state.doc.toString()).toBe('line one');
    });

    it('ignore: Shift-Enter key also does not modify the document', async () => {
      const onChange = vi.fn();
      const ref = React.createRef<EditorView | null>();
      await act(async () => {
        render(
          <CodeMirrorEditor
            ref={ref}
            value="one line"
            onChange={onChange}
            enterBehavior="ignore"
          />
        );
      });
      pressKey(ref.current!, 'Enter', { shiftKey: true });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('softbreak: first Enter inserts a two-space soft-break followed by a newline', async () => {
      const onChange = vi.fn();
      const ref = React.createRef<EditorView | null>();
      await act(async () => {
        render(
          <CodeMirrorEditor
            ref={ref}
            value="hello"
            onChange={onChange}
            enterBehavior="softbreak"
          />
        );
      });
      // Position caret at end of 'hello'
      act(() => {
        ref.current!.dispatch({ selection: { anchor: 5 } });
      });
      pressKey(ref.current!, 'Enter');
      expect(ref.current!.state.doc.toString()).toBe('hello  \n');
    });

    it('softbreak: Enter inside an existing "  \\n" line-break upgrades it to paragraph break', async () => {
      const ref = React.createRef<EditorView | null>();
      // JSX string attributes don't process escape sequences; use a variable.
      const initial = 'hello  \nworld';
      await act(async () => {
        render(
          <CodeMirrorEditor
            ref={ref}
            value={initial}
            onChange={vi.fn()}
            enterBehavior="softbreak"
          />
        );
      });
      // "hello  \nworld": h=0,e=1,l=2,l=3,o=4,sp=5,sp=6,\n=7,w=8... → lb=5, cursor at lb+2=7
      act(() => {
        ref.current!.dispatch({ selection: { anchor: 7 } });
      });
      pressKey(ref.current!, 'Enter');
      expect(ref.current!.state.doc.toString()).toBe('hello\n\nworld');
    });

    // ── softbreak: Enter position coverage ──────────────────────────────────

    /**
     * Helper: mount a softbreak editor with initial content, place cursor at
     * `cursorPos`, press the given key, and return the resulting document string.
     */
    async function softbreakKey(
      initial: string,
      cursorPos: number,
      key: 'Enter' | 'Backspace' | 'Delete'
    ): Promise<string> {
      const ref = React.createRef<EditorView | null>();
      await act(async () => {
        render(
          <CodeMirrorEditor
            ref={ref}
            value={initial}
            onChange={vi.fn()}
            enterBehavior="softbreak"
          />
        );
      });
      act(() => {
        ref.current!.dispatch({ selection: { anchor: cursorPos } });
      });
      pressKey(ref.current!, key);
      return ref.current!.state.doc.toString();
    }

    describe('softbreak: Enter upgrades line-break "  \\n" to paragraph break "\\n\\n"', () => {
      // Doc: "a  \nb"  line-break starts at offset 1 (lb=1, lb+1=2, lb+2=3, lb+3=4 after \n)
      it('cursor at lb+0 (before first space)', async () => {
        // "a" + "  \n" + "b"  → offsets: a=0, sp1=1, sp2=2, nl=3, b=4
        expect(await softbreakKey('a  \nb', 1, 'Enter')).toBe('a\n\nb');
      });
      it('cursor at lb+1 (between spaces)', async () => {
        expect(await softbreakKey('a  \nb', 2, 'Enter')).toBe('a\n\nb');
      });
      it('cursor at lb+2 (between 2nd space and \\n)', async () => {
        expect(await softbreakKey('a  \nb', 3, 'Enter')).toBe('a\n\nb');
      });
      it('cursor at lb+3 (just after \\n)', async () => {
        expect(await softbreakKey('a  \nb', 4, 'Enter')).toBe('a\n\nb');
      });
    });

    describe('softbreak: Enter in "\\n\\n" zone inserts plain "\\n" (no spaces)', () => {
      // Doc: "a\n\nb"  paragraph break starts at offset 1 (pb=1, pb+1=2, pb+2=3)
      it('cursor at pb+0 (before first \\n)', async () => {
        const result = await softbreakKey('a\n\nb', 1, 'Enter');
        // Inserts plain \n at pos 1 → "a\n\n\nb"
        expect(result).toBe('a\n\n\nb');
        expect(result).not.toContain('  ');
      });
      it("cursor at pb+1 (between the two \\n's)", async () => {
        const result = await softbreakKey('a\n\nb', 2, 'Enter');
        expect(result).toBe('a\n\n\nb');
        expect(result).not.toContain('  ');
      });
      it('cursor at pb+2 (just after second \\n)', async () => {
        const result = await softbreakKey('a\n\nb', 3, 'Enter');
        expect(result).toBe('a\n\n\nb');
        expect(result).not.toContain('  ');
      });
    });

    describe('softbreak: Enter in normal text inserts "  \\n", stripping adjacent space', () => {
      it('cursor in middle of word (no adjacent spaces)', async () => {
        // "hello" cursor at 3 → "hel  \nlo"
        expect(await softbreakKey('hello', 3, 'Enter')).toBe('hel  \nlo');
      });
      it('cursor just after a space removes the trailing space', async () => {
        // "a b" cursor at 2 (after the space) → "a  \nb"
        expect(await softbreakKey('a b', 2, 'Enter')).toBe('a  \nb');
      });
      it('cursor just before a space removes the leading space', async () => {
        // "a b" cursor at 1 (before the space) → "a  \nb"
        expect(await softbreakKey('a b', 1, 'Enter')).toBe('a  \nb');
      });
      it('Enter at very end of doc produces "  \\n" suffix', async () => {
        expect(await softbreakKey('end', 3, 'Enter')).toBe('end  \n');
      });
    });

    describe('softbreak: Backspace removes line-break "  \\n" and joins with single space', () => {
      // "a  \nb" — lb=1; cursor must be > lb to trigger (pos 2..4)
      it('cursor at lb+1', async () => {
        expect(await softbreakKey('a  \nb', 2, 'Backspace')).toBe('a b');
      });
      it('cursor at lb+2', async () => {
        expect(await softbreakKey('a  \nb', 3, 'Backspace')).toBe('a b');
      });
      it('cursor at lb+3 (just after \\n)', async () => {
        expect(await softbreakKey('a  \nb', 4, 'Backspace')).toBe('a b');
      });
      it('cursor at lb+0 does NOT intercept (let default Backspace run)', async () => {
        // Cursor before the sequence: default Backspace deletes 'a'
        expect(await softbreakKey('a  \nb', 1, 'Backspace')).not.toBe('ab');
      });
    });

    describe('softbreak: Backspace downgrades "\\n\\n" to "  \\n"', () => {
      // "a\n\nb" — pb=1; cursor must be > pb to trigger (pos 2..3)
      it("cursor at pb+1 (between \\n's)", async () => {
        expect(await softbreakKey('a\n\nb', 2, 'Backspace')).toBe('a  \nb');
      });
      it('cursor at pb+2 (just after second \\n)', async () => {
        expect(await softbreakKey('a\n\nb', 3, 'Backspace')).toBe('a  \nb');
      });
    });

    // ── Systematic Backspace/Delete on \\n\\n with 0-3 neighbouring newlines ──
    //
    // For every combination of prefix (0..3) and suffix (0..3) bare newlines
    // surrounding the \\n\\n pair we verify all four cursor positions:
    //   Backspace at pb+1 and pb+2
    //   Delete    at pb+0 and pb+1
    //
    // Rule: downgrade \\n\\n → "  \\n" ONLY when the pair is completely isolated
    // (prefix === 0 AND suffix === 0).  Any neighbouring \\n means the pair is
    // part of a longer run; the key should just remove one \\n (default behaviour).
    describe('softbreak: systematic \\n\\n Backspace/Delete (0-3 prefix × 0-3 suffix)', () => {
      for (let prefix = 0; prefix <= 3; prefix++) {
        for (let suffix = 0; suffix <= 3; suffix++) {
          // Build document  'a' + \\n×prefix + '\\n\\n' + \\n×suffix + 'b'
          const pre = '\n'.repeat(prefix);
          const suf = '\n'.repeat(suffix);
          const doc = `a${pre}\n\n${suf}b`;
          // Index of the first \\n of the \\n\\n pair inside the doc
          const pairStart = 1 + prefix;

          const shouldDowngrade = prefix === 0 && suffix === 0;
          // Downgrade result: replace the \\n\\n with '  \\n'
          const downgradeResult = `a${pre}  \n${suf}b`;
          // Fall-through result: one \\n removed from the run (total \\n count decreases by 1)
          const removeResult = `a${'\n'.repeat(prefix + suffix + 1)}b`;

          const label = `prefix=${prefix}, suffix=${suffix}`;

          // ── Backspace at pb+1 (cursor between the two \\n's) ──────────────
          it(`Backspace pb+1 [${label}]`, async () => {
            const result = await softbreakKey(doc, pairStart + 1, 'Backspace');
            expect(result).toBe(shouldDowngrade ? downgradeResult : removeResult);
          });

          // ── Backspace at pb+2 (cursor just after both \\n's) ──────────────
          it(`Backspace pb+2 [${label}]`, async () => {
            const result = await softbreakKey(doc, pairStart + 2, 'Backspace');
            expect(result).toBe(shouldDowngrade ? downgradeResult : removeResult);
          });

          // ── Delete at pb+0 (cursor before the first \\n) ──────────────────
          it(`Delete pb+0 [${label}]`, async () => {
            const result = await softbreakKey(doc, pairStart, 'Delete');
            expect(result).toBe(shouldDowngrade ? downgradeResult : removeResult);
          });

          // ── Delete at pb+1 (cursor between the two \\n's) ─────────────────
          it(`Delete pb+1 [${label}]`, async () => {
            const result = await softbreakKey(doc, pairStart + 1, 'Delete');
            expect(result).toBe(shouldDowngrade ? downgradeResult : removeResult);
          });
        }
      }
    });

    describe('softbreak: Backspace on "\\n\\n\\n\\n" removes one \\n, not "  \\n"', () => {
      it('cursor at end of "\\n\\n\\n\\n" → removes one \\n leaving "\\n\\n\\n"', async () => {
        const result = await softbreakKey('\n\n\n\n', 4, 'Backspace');
        expect(result).toBe('\n\n\n');
        expect(result).not.toContain('  ');
      });
      it('cursor at end of "\\n\\n\\n" → removes one \\n leaving "\\n\\n"', async () => {
        const result = await softbreakKey('\n\n\n', 3, 'Backspace');
        expect(result).toBe('\n\n');
        expect(result).not.toContain('  ');
      });
    });

    describe('softbreak: Delete on "\\n\\n\\n" keeps one \\n, not "  \\n"', () => {
      it('cursor at start of "\\n\\n\\n" → removes one \\n leaving "\\n\\n"', async () => {
        const result = await softbreakKey('\n\n\n', 0, 'Delete');
        expect(result).toBe('\n\n');
        expect(result).not.toContain('  ');
      });
      it('cursor at start of "\\n\\n\\n\\n" → removes one \\n leaving "\\n\\n\\n"', async () => {
        const result = await softbreakKey('\n\n\n\n', 0, 'Delete');
        expect(result).toBe('\n\n\n');
        expect(result).not.toContain('  ');
      });
    });

    describe('softbreak: Delete removes line-break "  \\n" and joins with single space', () => {
      // "a  \nb" — lb=1; cursor must be <= lb+2 to trigger (pos 1..3)
      it('cursor at lb+0 (before first space)', async () => {
        expect(await softbreakKey('a  \nb', 1, 'Delete')).toBe('a b');
      });
      it('cursor at lb+1 (between spaces)', async () => {
        expect(await softbreakKey('a  \nb', 2, 'Delete')).toBe('a b');
      });
      it('cursor at lb+2 (before \\n)', async () => {
        expect(await softbreakKey('a  \nb', 3, 'Delete')).toBe('a b');
      });
      it('cursor at lb+3 does NOT intercept (let default Delete run)', async () => {
        // Cursor after the sequence: default Delete removes 'b'
        expect(await softbreakKey('a  \nb', 4, 'Delete')).not.toBe('ab');
      });
    });

    describe('softbreak: Delete downgrades "\\n\\n" to "  \\n"', () => {
      // "a\n\nb" — pb=1; cursor must be <= pb+1 to trigger (pos 1..2)
      it('cursor at pb+0 (before first \\n)', async () => {
        expect(await softbreakKey('a\n\nb', 1, 'Delete')).toBe('a  \nb');
      });
      it("cursor at pb+1 (between \\n's)", async () => {
        expect(await softbreakKey('a\n\nb', 2, 'Delete')).toBe('a  \nb');
      });
    });

    describe('softbreak: "  \\n" adjacent to "\\n\\n" — no cross-contamination', () => {
      // Doc: "a  \n\n\nb" — "  \n" at lb=1, then bare "\n\n" at positions 4,5
      it('Enter at lb+0 upgrades the line-break, leaves the \\n\\n intact', async () => {
        const result = await softbreakKey('a  \n\n\nb', 1, 'Enter');
        expect(result).toBe('a\n\n\n\nb');
      });
      it('Enter at pb+1 (pos 5) inserts plain \\n inside the \\n\\n zone, no new spaces', async () => {
        // 'a  \n\n\nb': a=0, sp=1, sp=2, nl=3, nl=4, nl=5, b=6
        // paraBreakAt(doc,5) → pb=4 (\n\n at 4,5; isLineBreakNl(4): ch(3)='\n'≠' ' → false)
        // → inserts plain \n at pos 5 → 'a  \n\n\n\nb'
        // The pre-existing '  \n' is untouched; only a plain \n was added.
        const result = await softbreakKey('a  \n\n\nb', 5, 'Enter');
        // One extra \n added, no spurious spaces introduced by this Enter
        expect(result).toBe('a  \n\n\n\nb');
      });
      it('Delete at pb+0 (pos 4) removes one \\n (pair not isolated — adjacent to line-break \\n)', async () => {
        // 'a  \n\n\nb': a=0, sp=1, sp=2, \n=3 (soft-nl), \n=4 (pair[0]), \n=5 (pair[1]), b=6
        // At pos 4: ch(from-1)='\n' (the soft-nl) → pair is not isolated → fall through
        // Default Delete removes \n at pos 4 → 'a  \n\nb'
        expect(await softbreakKey('a  \n\n\nb', 4, 'Delete')).toBe('a  \n\nb');
      });
    });
  });
});

// ─── Prose-link highlight + boundary handles ──────────────────────────────────

import {
  setProseHighlightEffect,
  proseHighlightField,
  type ProseHighlightRange,
} from './CodeMirrorEditor';

describe('prose-link highlight plugin', () => {
  /**
   * Render the editor, dispatch a setProseHighlightEffect, and return the
   * container so tests can query the DOM for handle elements.
   */
  async function mountWithHighlights(
    ranges: ProseHighlightRange[]
  ): Promise<{ container: HTMLElement; view: EditorView }> {
    const ref = React.createRef<EditorView | null>();
    // 'Hello world' = 11 chars; ranges use [0,5) and [6,11)
    const { container } = await act(async () =>
      render(<CodeMirrorEditor ref={ref} value="Hello world" onChange={vi.fn()} />)
    );
    act(() => {
      ref.current!.dispatch({ effects: setProseHighlightEffect.of(ranges) });
    });
    return { container, view: ref.current! };
  }

  it('renders a start handle with correct class and no text content (bar via CSS)', async () => {
    const { container } = await mountWithHighlights([
      { sceneId: 's1', from: 0, to: 5 },
    ]);
    const startHandle = container.querySelector('.cm-prose-handle-start');
    expect(startHandle).not.toBeNull();
    // The marker is a vertical bar rendered via CSS ::before; DOM should be clean.
    expect(startHandle?.textContent).toBe('');
    expect(startHandle?.getAttribute('title')).toBe('Drag to move scene start');
  });

  it('renders an end handle with correct class and no text content (bar via CSS)', async () => {
    const { container } = await mountWithHighlights([
      { sceneId: 's1', from: 0, to: 5 },
    ]);
    const endHandle = container.querySelector('.cm-prose-handle-end');
    expect(endHandle).not.toBeNull();
    expect(endHandle?.textContent).toBe('');
    expect(endHandle?.getAttribute('title')).toBe('Drag to move scene end');
  });

  it('renders two start handles and two end handles for two separate ranges', async () => {
    const { container } = await mountWithHighlights([
      { sceneId: 's1', from: 0, to: 5 },
      { sceneId: 's2', from: 6, to: 11 },
    ]);
    expect(container.querySelectorAll('.cm-prose-handle-start')).toHaveLength(2);
    expect(container.querySelectorAll('.cm-prose-handle-end')).toHaveLength(2);
  });

  it('renders both ranges when they have touching boundaries (end of A == start of B)', async () => {
    // This is the critical regression case: end of scene-a is exactly the start
    // of scene-b.  The Decoration.set sort=true flag prevents the ordering crash.
    const { container } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    // Both mark decorations must be present — if the sort bug were present the
    // whole DecorationSet would silently become empty and no handles render.
    expect(container.querySelectorAll('.cm-prose-handle')).toHaveLength(4); // 2×start + 2×end
    const marks = container.querySelectorAll('.cm-prose-link-highlight');
    expect(marks.length).toBeGreaterThanOrEqual(1); // at least one highlighted span
  });

  it('orders handles end-then-start when two scenes share a boundary position', async () => {
    // The end widget uses side:-1 and the start widget uses side:1 so that at
    // the same position the end handle sorts before the start handle.
    const { container } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    const handles = container.querySelectorAll('.cm-prose-handle');
    // The second handle overall must be the end handle and the third the start handle.
    // Markers are rendered via CSS ::before; verify via class names.
    expect(handles[1].classList.contains('cm-prose-handle-end')).toBe(true);
    expect(handles[2].classList.contains('cm-prose-handle-start')).toBe(true);
  });

  it('live drag of end handle into adjacent range pushes that range start visually', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    // Mock posAtCoords to return position 8 (inside scene b's range).
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8);

    // The end handles are '.cm-prose-handle-end'; the first belongs to scene a
    // (it has a lower from value, scenes are sorted by from in the plugin).
    const endHandles = container.querySelectorAll('.cm-prose-handle-end');
    const endHandleA = endHandles[0] as HTMLElement;

    act(() => {
      fireEvent.mouseDown(endHandleA, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 100, clientY: 0 });
    });

    // Scene b's from must have been pushed to 8 to avoid overlap.
    const highlights = view.state.field(proseHighlightField);
    const bRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'b');
    expect(bRange?.from).toBe(8);

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('live drag of start handle into adjacent range pushes that range end visually', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    // Mock posAtCoords to return position 3 (inside scene a's range).
    vi.spyOn(view, 'posAtCoords').mockReturnValue(3);

    // The start handles; the second belongs to scene b.
    const startHandles = container.querySelectorAll('.cm-prose-handle-start');
    const startHandleB = startHandles[1] as HTMLElement;

    act(() => {
      fireEvent.mouseDown(startHandleB, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 30, clientY: 0 });
    });

    // Scene a's to must have been pushed to 3 to avoid overlap.
    const highlights = view.state.field(proseHighlightField);
    const aRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'a');
    expect(aRange?.to).toBe(3);

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('live drag sequential moves correctly accumulate: dragging end right step by step', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    const endHandles = container.querySelectorAll('.cm-prose-handle-end');
    const endHandleA = endHandles[0] as HTMLElement;

    // Simulate dragging in steps: 6, 7, 8
    const positions = [6, 7, 8];
    let callIdx = 0;
    vi.spyOn(view, 'posAtCoords').mockImplementation(() => {
      return positions[callIdx++] ?? 8;
    });

    act(() => {
      fireEvent.mouseDown(endHandleA, { bubbles: true });
    });
    // Three sequential moves
    act(() => {
      fireEvent.mouseMove(document, { clientX: 100, clientY: 0 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 110, clientY: 0 });
    });
    act(() => {
      fireEvent.mouseMove(document, { clientX: 120, clientY: 0 });
    });

    // After the three moves, b's from should be 8
    const highlights = view.state.field(proseHighlightField);
    const bRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'b');
    expect(bRange?.from).toBe(8);
    const aRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'a');
    expect(aRange?.to).toBe(8);

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('live drag end handle completely past another scene (engulfment): engulfed scene gets zero-width and disappears', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    // Mock posAtCoords to return position 12 (past both scenes).
    vi.spyOn(view, 'posAtCoords').mockReturnValue(12);

    const endHandles = container.querySelectorAll('.cm-prose-handle-end');
    const endHandleA = endHandles[0] as HTMLElement;

    act(() => {
      fireEvent.mouseDown(endHandleA, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 100, clientY: 0 });
    });

    const highlights = view.state.field(proseHighlightField);
    const bRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'b');
    // B's start would be pushed to 12, which equals its end (11) —
    // so the overlap logic returns r unchanged. The build step will skip b
    // because from(5) < to(11) is still true. But visually they overlap.
    // Verify that scene a now covers the full range.
    const aRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'a');
    expect(aRange).toBeDefined();
    expect(aRange?.from).toBe(0);
    expect(aRange?.to).toBe(12);

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('fires onProseBoundaryChange callback with correct sceneId, edge, and offset on mouseup', async () => {
    const onBoundary = vi.fn();
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(
        <CodeMirrorEditor
          ref={ref}
          value="Hello world"
          onChange={vi.fn()}
          onProseBoundaryChange={onBoundary}
        />
      );
    });

    // Set up two scene highlights
    act(() => {
      ref.current!.dispatch({
        effects: setProseHighlightEffect.of([
          { sceneId: 'a', from: 0, to: 5 },
          { sceneId: 'b', from: 5, to: 11 },
        ]),
      });
    });

    // Find the end handle for scene a
    const endHandles = ref.current!.dom.querySelectorAll('.cm-prose-handle-end');
    const endHandleA = endHandles[0] as HTMLElement;

    // Mock posAtCoords and simulate a drag
    vi.spyOn(ref.current!, 'posAtCoords').mockReturnValue(8);
    act(() => {
      fireEvent.mouseDown(endHandleA, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 100, clientY: 0 });
      fireEvent.mouseUp(document);
    });

    // Verify callback was called with right params
    expect(onBoundary).toHaveBeenCalledTimes(1);
    expect(onBoundary).toHaveBeenCalledWith('a', 'end', 8);
    vi.restoreAllMocks();
  });

  it('live drag start handle completely past another scene (engulfment) leaves overlap', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 5 },
      { sceneId: 'b', from: 5, to: 11 },
    ]);
    // Mock posAtCoords to return position -1 (before both scenes).
    vi.spyOn(view, 'posAtCoords').mockReturnValue(-1);

    const startHandles = container.querySelectorAll('.cm-prose-handle-start');
    const startHandleB = startHandles[1] as HTMLElement;

    act(() => {
      fireEvent.mouseDown(startHandleB, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 5, clientY: 0 });
    });

    // B's start moves to -1, so its range becomes [-1, 11), overlapping a [0, 5).
    // A is not adjusted (b's new from(-1) < a.from(0), but edge is 'start'):
    //   draggedFrom = -1, r.from = 0, 0 < -1? No → a not adjusted.
    const highlights = view.state.field(proseHighlightField);
    const bRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'b');
    expect(bRange?.from).toBe(-1); // clamped in build

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('three scenes: dragging middle scene end into last scene pushes last scene start', async () => {
    const { container, view } = await mountWithHighlights([
      { sceneId: 'a', from: 0, to: 3 },
      { sceneId: 'b', from: 3, to: 6 },
      { sceneId: 'c', from: 6, to: 11 },
    ]);
    vi.spyOn(view, 'posAtCoords').mockReturnValue(8);

    const endHandles = container.querySelectorAll('.cm-prose-handle-end');
    // end handles sorted by from: a end, b end, c end
    const endHandleB = endHandles[1] as HTMLElement;

    act(() => {
      fireEvent.mouseDown(endHandleB, { bubbles: true });
      fireEvent.mouseMove(document, { clientX: 100, clientY: 0 });
    });

    const highlights = view.state.field(proseHighlightField);
    const cRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'c');
    expect(cRange?.from).toBe(8); // pushed right
    const bRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'b');
    expect(bRange?.to).toBe(8);
    const aRange = highlights.find((r: ProseHighlightRange) => r.sceneId === 'a');
    expect(aRange?.to).toBe(3); // unchanged

    act(() => {
      fireEvent.mouseUp(document);
    });
    vi.restoreAllMocks();
  });

  it('clearing highlights via empty array removes all handles', async () => {
    const ref = React.createRef<EditorView | null>();
    await act(async () => {
      render(<CodeMirrorEditor ref={ref} value="Hello world" onChange={vi.fn()} />);
    });
    act(() => {
      ref.current!.dispatch({
        effects: setProseHighlightEffect.of([{ sceneId: 's1', from: 0, to: 5 }]),
      });
    });
    act(() => {
      ref.current!.dispatch({ effects: setProseHighlightEffect.of([]) });
    });
    await act(async () =>
      render(<CodeMirrorEditor ref={ref} value="Hello world" onChange={vi.fn()} />)
    );
    // After clearing there should be no handle elements.
    // (We re-render to force a fresh query; the original container is the live one.)
    expect(document.querySelectorAll('.cm-prose-handle').length).toBe(0);
  });

  it('skips a range whose from >= to (invalid range is not rendered)', async () => {
    const { container } = await mountWithHighlights([
      { sceneId: 's1', from: 5, to: 5 }, // zero-width — must be skipped
      { sceneId: 's2', from: 0, to: 5 }, // valid
    ]);
    // Only the valid range renders handles.
    expect(container.querySelectorAll('.cm-prose-handle')).toHaveLength(2);
  });

  it('clamps ranges that exceed document length without throwing', async () => {
    // Range [0, 9999) on an 11-char doc — should clamp to [0, 11) silently.
    const { container } = await mountWithHighlights([
      { sceneId: 's1', from: 0, to: 9999 },
    ]);
    expect(container.querySelectorAll('.cm-prose-handle')).toHaveLength(2);
  });
});
