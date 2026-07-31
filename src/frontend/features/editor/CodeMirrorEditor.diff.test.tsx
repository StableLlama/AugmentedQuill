// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for the diff-highlighting feature in CodeMirrorEditor.
 * Verifies that text insertions relative to a baseline value are decorated.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { CodeMirrorEditor } from './CodeMirrorEditor';

function collectHighlightPayloadTokens(
  root: ParentNode,
  mode: 'inserted' | 'deleted'
): string[] {
  const rawTokens: string[] = [];
  const targetClass = mode === 'inserted' ? 'cm-diff-inserted' : 'cm-diff-deleted';
  const content = root.querySelector('.cm-content');

  const visit = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains('cm-ws-marker') && el.dataset.wsDiff === '1') {
        if (el.dataset.wsMarker === '1') {
          rawTokens.push('WS:space');
        } else if (el.dataset.wsTab === '1') {
          rawTokens.push('WS:tab');
        } else if (el.dataset.wsNl === '1') {
          rawTokens.push('WS:newline');
        }
        return;
      }
      for (const child of Array.from(el.childNodes)) {
        visit(child);
      }
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as ChildNode).parentElement;
      if (!parent?.closest(`.${targetClass}`)) {
        return;
      }
      const text = node.textContent ?? '';
      if (text.length > 0) {
        rawTokens.push(`TXT:${text}`);
      }
    }
  };

  if (content) {
    visit(content);
  }

  // Normalize adjacent TXT nodes so equivalent DOM payload with different text-node
  // chunking compares equal.
  const tokens: string[] = [];
  for (const token of rawTokens) {
    if (token.startsWith('TXT:')) {
      const text = token.slice(4);
      const last = tokens[tokens.length - 1];
      if (last?.startsWith('TXT:')) {
        tokens[tokens.length - 1] = `TXT:${last.slice(4)}${text}`;
      } else {
        tokens.push(token);
      }
    } else {
      tokens.push(token);
    }
  }

  return tokens;
}

function collectNormalizedHighlightPayloadHtml(
  root: ParentNode,
  mode: 'inserted' | 'deleted'
): string {
  const targetClass = mode === 'inserted' ? 'cm-diff-inserted' : 'cm-diff-deleted';
  const content = root.querySelector('.cm-content');
  const chunks: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      if (el.classList.contains('cm-ws-marker') && el.dataset.wsDiff === '1') {
        const kind =
          el.dataset.wsMarker === '1'
            ? 'space'
            : el.dataset.wsTab === '1'
              ? 'tab'
              : 'newline';
        chunks.push(`<ws kind="${kind}">${el.innerHTML}</ws>`);
        return;
      }

      if (el.tagName === 'BR') {
        const parent = el.parentElement;
        if (!parent?.closest(`.${targetClass}`)) {
          return;
        }
        chunks.push('<br/>');
        return;
      }

      for (const child of Array.from(el.childNodes)) {
        visit(child);
      }
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as ChildNode).parentElement;
      if (!parent?.closest(`.${targetClass}`)) {
        return;
      }
      const text = node.textContent ?? '';
      if (text.length > 0) {
        chunks.push(`<txt>${text}</txt>`);
      }
    }
  };

  if (content) {
    visit(content);
  }

  return chunks.join('');
}

function collectStrictDiffNodeSequence(
  root: ParentNode,
  mode: 'inserted' | 'deleted'
): string[] {
  const targetClass = mode === 'inserted' ? 'cm-diff-inserted' : 'cm-diff-deleted';
  const content = root.querySelector('.cm-content');
  if (!content) {
    return [];
  }

  const sequence: string[] = [];
  const nodes = Array.from(content.querySelectorAll<HTMLElement>('img, span'));

  for (const el of nodes) {
    if (
      el.tagName === 'IMG' &&
      el.classList.contains('cm-widgetBuffer') &&
      el.getAttribute('aria-hidden') === 'true'
    ) {
      const prev = el.previousElementSibling as HTMLElement | null;
      const next = el.nextElementSibling as HTMLElement | null;
      const isNearRelevant =
        !!prev?.matches(`.cm-ws-marker[data-ws-diff='1'], .${targetClass}`) ||
        !!next?.matches(`.cm-ws-marker[data-ws-diff='1'], .${targetClass}`);
      if (isNearRelevant) {
        sequence.push('BUF');
      }
      continue;
    }

    if (el.classList.contains('cm-ws-marker') && el.dataset.wsDiff === '1') {
      const classList = Array.from(el.classList)
        .filter(
          (cls: string) => cls !== 'cm-diff-inserted' && cls !== 'cm-diff-deleted'
        )
        .sort()
        .join('.');
      if (el.dataset.wsMarker === '1') {
        sequence.push(`WS:space:${classList}`);
      } else if (el.dataset.wsTab === '1') {
        sequence.push(`WS:tab:${classList}`);
      } else if (el.dataset.wsNl === '1') {
        sequence.push(`WS:newline:${classList}`);
      }
      continue;
    }

    if (el.classList.contains(targetClass)) {
      const text = el.textContent ?? '';
      if (text.length > 0) {
        const classList = Array.from(el.classList)
          .filter(
            (cls: string) => cls !== 'cm-diff-inserted' && cls !== 'cm-diff-deleted'
          )
          .sort()
          .join('.');
        sequence.push(`TXT:${classList}:${text}`);
      }
    }
  }

  return sequence;
}

afterEach(() => {
  cleanup();
});

describe('CodeMirrorEditor Diff Highlighting', () => {
  it('identifies and marks inserted text when baselineValue is provided', async () => {
    const baseline = 'The quick brown fox';
    const current = 'The quick red brown fox';
    const ref = React.createRef<EditorView | null>();

    await act(async () => {
      render(
        <CodeMirrorEditor
          ref={ref}
          value={current}
          baselineValue={baseline}
          onChange={vi.fn()}
        />
      );
    });

    const view = ref.current!;
    expect(view.state.doc.toString()).toBe(current);

    // CodeMirror decorations are applied via a ViewPlugin.
    // We check if the 'diff-inserted' class is present in the DOM for the 'red ' part.
    const content = view.contentDOM.innerHTML;

    // Note: CodeMirror might split the text into multiple spans or elements.
    // We expect to find the 'diff-inserted' class somewhere.
    expect(content).toContain('diff-inserted');
    expect(content).toContain('red');
  });

  it('updates decorations when baselineValue or value changes', async () => {
    const ref = React.createRef<EditorView | null>();
    const { rerender } = render(
      <CodeMirrorEditor
        ref={ref}
        value="Initial"
        baselineValue="Initial"
        onChange={vi.fn()}
      />
    );

    // No highlights initially
    expect(ref.current!.contentDOM.innerHTML).not.toContain('diff-inserted');

    // Change value to add text
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="Initial with more"
          baselineValue="Initial"
          onChange={vi.fn()}
        />
      );
    });

    expect(ref.current!.contentDOM.innerHTML).toContain('diff-inserted');
    expect(ref.current!.contentDOM.innerHTML).toContain('with more');

    // Update baseline to match value -> highlights should disappear
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="Initial with more"
          baselineValue="Initial with more"
          onChange={vi.fn()}
        />
      );
    });

    expect(ref.current!.contentDOM.innerHTML).not.toContain('diff-inserted');
  });

  it('does not show diff decorations when showDiff is disabled', async () => {
    const ref = React.createRef<EditorView | null>();

    render(
      <CodeMirrorEditor
        ref={ref}
        value="The quick red brown fox"
        baselineValue="The quick brown fox"
        showDiff={false}
        onChange={vi.fn()}
      />
    );

    expect(ref.current!.contentDOM.innerHTML).not.toContain('diff-inserted');
  });

  it('tags inserted whitespace markers for diff highlighting when WS is enabled', async () => {
    const ref = React.createRef<EditorView | null>();
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="a b"
        baselineValue="ab"
        showWhitespace={true}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    expect(ref.current!.state.doc.toString()).toBe('a b');
    const insertedSpace = container.querySelector(
      '.cm-ws-marker[data-ws-marker="1"][data-ws-diff="1"]'
    );
    expect(insertedSpace).toBeTruthy();
  });

  it('shows deleted newline marker when WS is enabled', async () => {
    const { container } = render(
      <CodeMirrorEditor
        value="line one"
        baselineValue={'line one\n'}
        showWhitespace={true}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const deletedNewline = container.querySelector(
      '.cm-ws-marker.cm-diff-deleted[data-ws-nl="1"][data-ws-diff="1"]'
    );
    expect(deletedNewline).toBeTruthy();
  });

  it('keeps deleted space marker glyph visible when WS is enabled', async () => {
    const { container } = render(
      <CodeMirrorEditor
        value="ab"
        baselineValue={'a b'}
        showWhitespace={true}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const deletedSpaceGlyph = container.querySelector(
      '.cm-ws-marker.cm-diff-deleted[data-ws-marker="1"][data-ws-diff="1"] .cm-ws-glyph'
    );
    expect(deletedSpaceGlyph).toBeTruthy();
  });

  it('renders deleted tabs without red-only placeholder wrappers when WS is disabled', async () => {
    const { container } = render(
      <CodeMirrorEditor
        value="ab"
        baselineValue={'a\tb'}
        showWhitespace={false}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const deletedSpan = container.querySelector('.cm-diff-deleted');
    expect(deletedSpan).toBeTruthy();
    expect(deletedSpan?.textContent).toContain('\t');
  });

  it('does not render inline scene markers in deleted diff payload', async () => {
    const marker = '<!--scene:11:start-->';
    const { container } = render(
      <CodeMirrorEditor
        value={'Alpha'}
        baselineValue={`${marker}Alpha`}
        showWhitespace={false}
        showDiff={true}
        hideSceneMarkers={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const deletedSpans = Array.from(
      container.querySelectorAll<HTMLSpanElement>('.cm-diff-deleted')
    );
    const deletedText = deletedSpans
      .map((span: HTMLSpanElement) => span.textContent ?? '')
      .join('');
    expect(deletedText).not.toContain('<!--scene:11:start-->');
  });

  it('does not render inline annotation markers in deleted diff payload', async () => {
    const marker = '<!--annotation:note-1:start-->';
    const { container } = render(
      <CodeMirrorEditor
        value={'Alpha'}
        baselineValue={`${marker}Alpha`}
        showWhitespace={false}
        showDiff={true}
        hideSceneMarkers={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const deletedSpans = Array.from(
      container.querySelectorAll<HTMLSpanElement>('.cm-diff-deleted')
    );
    const deletedText = deletedSpans
      .map((span: HTMLSpanElement) => span.textContent ?? '')
      .join('');
    expect(deletedText).not.toContain('<!--annotation:note-1:start-->');
  });

  it('keeps highlighted DOM sequence identical for space+text+space between green and red', async () => {
    const changedPart = ' seen—of ';
    const fullText = `Start${changedPart}Finish`;
    const reducedText = 'StartFinish';

    const { container, rerender } = render(
      <CodeMirrorEditor
        value={fullText}
        baselineValue={reducedText}
        showWhitespace={true}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const greenTokens = collectHighlightPayloadTokens(container, 'inserted');
    expect(greenTokens.length).toBeGreaterThan(0);
    const greenPayloadHtml = collectNormalizedHighlightPayloadHtml(
      container,
      'inserted'
    );
    expect(greenPayloadHtml.length).toBeGreaterThan(0);
    const greenSequence = collectStrictDiffNodeSequence(container, 'inserted');
    expect(greenSequence.length).toBeGreaterThan(0);

    await act(async () => {
      rerender(
        <CodeMirrorEditor
          value={reducedText}
          baselineValue={fullText}
          showWhitespace={true}
          showDiff={true}
          onChange={vi.fn()}
        />
      );
    });

    const redTokens = collectHighlightPayloadTokens(container, 'deleted');
    expect(redTokens.length).toBeGreaterThan(0);
    expect(redTokens).toEqual(greenTokens);

    const redPayloadHtml = collectNormalizedHighlightPayloadHtml(container, 'deleted');
    expect(redPayloadHtml.replaceAll('<br/>', '')).toEqual(
      greenPayloadHtml.replaceAll('<br/>', '')
    );

    const redSequence = collectStrictDiffNodeSequence(container, 'deleted');
    expect(redSequence).toEqual(greenSequence);
  });

  it('renders deleted newline breaks for long mixed whitespace changes', async () => {
    const deletedPart =
      ' -- bridge\twith tab\nline with  two spaces\n\nnew paragraph\tend';
    const fullText = `Start${deletedPart} Finish`;
    const reducedText = 'Start Finish';

    const { container } = render(
      <CodeMirrorEditor
        value={reducedText}
        baselineValue={fullText}
        showWhitespace={true}
        showDiff={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    const redBreaks = container.querySelectorAll('.cm-diff-deleted-break').length;
    const newlineCount = (deletedPart.match(/\n/g) ?? []).length;
    expect(newlineCount).toBeGreaterThan(0);
    expect(redBreaks).toBe(newlineCount);
  });

  it('shows no diff when baseline differs from value only by markers', async () => {
    // Simulates the annotation-creation scenario: the baseline (from
    // baselineState) contains internal markers, the editor document is
    // always stripped.  When prose is identical the diff must be empty.
    const { container } = render(
      <CodeMirrorEditor
        value={'The scent of jasmine filled the air'}
        baselineValue={
          '<!--scene:1:start-->The scent of <!--annotation:a1:start-->jasmine' +
          '<!--annotation:a1:end--> filled the air<!--scene:1:end-->'
        }
        showWhitespace={false}
        showDiff={true}
        hideSceneMarkers={true}
        onChange={vi.fn()}
      />
    );

    await act(async () => {});

    expect(container.querySelector('.cm-diff-inserted')).toBeNull();
    expect(container.querySelector('.cm-diff-deleted')).toBeNull();
  });
});

// ─── User-edit diff suppression ─────────────────────────────────────────────
// When the user manually types, their own edits must NOT produce diff
// decorations.  Only automatic (external-sync) changes should show diffs.
// The diff plugin achieves this by patching the baseline on user edits.

describe('CodeMirrorEditor – user edits do not produce diff', () => {
  it('user typing does not show as diff insertion when baseline differs', async () => {
    const ref = React.createRef<EditorView | null>();
    const onChange = vi.fn();

    // Simulate: AI changed "Hello" → "Hello World", baseline still "Hello"
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="Hello World"
        baselineValue="Hello"
        showDiff={true}
        onChange={onChange}
      />
    );

    await act(async () => {});

    // The AI insertion " World" should be visible as a diff.
    expect(container.querySelector('.cm-diff-inserted')).toBeTruthy();

    // Now simulate user typing: replace "World" with "there"
    const view = ref.current!;
    await act(async () => {
      view.dispatch({
        changes: { from: 6, to: 11, insert: 'there' },
        // Deliberately NOT annotating with externalValueSyncAnnotation
      });
    });

    // After user edit, the diff for the edited region should be gone
    // because the baseline was patched to match.
    const insertedEls = container.querySelectorAll('.cm-diff-inserted');
    // The text is now "Hello there". No diff should remain because the
    // baseline was patched to match at the edited position.
    expect(insertedEls.length).toBe(0);
    expect(view.state.doc.toString()).toBe('Hello there');
  });

  it('AI diff remains visible in untouched regions after user edits elsewhere', async () => {
    const ref = React.createRef<EditorView | null>();
    const onChange = vi.fn();

    // AI added two words: "brave" at pos 6 and "quickly" at a later position.
    const { container } = render(
      <CodeMirrorEditor
        ref={ref}
        value="Hello brave world and quickly run"
        baselineValue="Hello world and run"
        showDiff={true}
        onChange={onChange}
      />
    );

    await act(async () => {});

    // Both AI insertions should be visible.
    let insertedEls = container.querySelectorAll('.cm-diff-inserted');
    expect(insertedEls.length).toBeGreaterThanOrEqual(1);

    // User types at the beginning, away from the AI insertions.
    const view = ref.current!;
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: 0, insert: 'Why ' },
      });
    });

    // The AI diffs should still be present in untouched regions.
    insertedEls = container.querySelectorAll('.cm-diff-inserted');
    expect(insertedEls.length).toBeGreaterThanOrEqual(1);
    expect(view.state.doc.toString()).toBe('Why Hello brave world and quickly run');
  });

  it('external sync (AI change) does produce diff decorations', async () => {
    const ref = React.createRef<EditorView | null>();
    const onChange = vi.fn();

    const { container, rerender } = render(
      <CodeMirrorEditor
        ref={ref}
        value="Hello"
        baselineValue="Hello"
        showDiff={true}
        onChange={onChange}
      />
    );

    await act(async () => {});

    // No diff initially (baseline == content)
    expect(container.querySelector('.cm-diff-inserted')).toBeNull();

    // Simulate AI push: parent updates value but keeps baseline
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="Hello AI world"
          baselineValue="Hello"
          showDiff={true}
          onChange={onChange}
        />
      );
    });

    // AI insertion should be visible as diff
    expect(container.querySelector('.cm-diff-inserted')).toBeTruthy();
  });

  it('accepting a diff (setting baseline to match value) clears decorations', async () => {
    const ref = React.createRef<EditorView | null>();
    const onChange = vi.fn();

    const { container, rerender } = render(
      <CodeMirrorEditor
        ref={ref}
        value="Hello World"
        baselineValue="Hello"
        showDiff={true}
        onChange={onChange}
      />
    );

    await act(async () => {});

    // AI diff visible
    expect(container.querySelector('.cm-diff-inserted')).toBeTruthy();

    // Parent accepts: sets baseline to match current value
    await act(async () => {
      rerender(
        <CodeMirrorEditor
          ref={ref}
          value="Hello World"
          baselineValue="Hello World"
          showDiff={true}
          onChange={onChange}
        />
      );
    });

    // Diff should be gone
    expect(container.querySelector('.cm-diff-inserted')).toBeNull();
  });
});
