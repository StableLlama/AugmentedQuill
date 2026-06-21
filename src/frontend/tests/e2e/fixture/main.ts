/**
 * Purpose: Minimal CodeMirror editor fixture for Playwright E2E tests.
 * Uses the same CodeMirror packages installed in node_modules.
 */

import {
  EditorView,
  keymap,
  drawSelection,
  Decoration,
  ViewPlugin,
  ViewUpdate,
  DecorationSet,
  MatchDecorator,
  WidgetType,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';

// ── scene marker helpers ────────────────────────────────────────────────

const SCENE_MARKER_REGEX = /<!--(?:scene|annotation):[^:>]+:(?:start|end)-->/g;
const sceneMarkerToken = (id: string, edge: 'start' | 'end'): string =>
  `<!--scene:${id}:${edge}-->`;

const content =
  'Hello ' +
  sceneMarkerToken('a', 'start') +
  'Alice walks into the room' +
  sceneMarkerToken('a', 'end') +
  ' and then ' +
  sceneMarkerToken('b', 'start') +
  'Bob nods silently' +
  sceneMarkerToken('b', 'end') +
  '. The end.';

// ── hidden marker widget ─────────────────────────────────────────────────

class SceneMarkerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = '\u200B';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const markerHideDecorator = new MatchDecorator({
  regexp: SCENE_MARKER_REGEX,
  decoration: Decoration.replace({ widget: new SceneMarkerWidget() }),
});

// ── prose highlight state ────────────────────────────────────────────────

interface ProseHighlightRange {
  sceneId: string;
  from: number;
  to: number;
}

const setProseHighlightEffect = StateEffect.define<ProseHighlightRange[]>();
const proseHighlightField = StateField.define<ProseHighlightRange[]>({
  create: () => [],
  update(value: ProseHighlightRange[], tr: Transaction) {
    for (const e of tr.effects) if (e.is(setProseHighlightEffect)) return e.value;
    return value;
  },
});

// ── drag handle widget ───────────────────────────────────────────────────

class ProseHandleWidget extends WidgetType {
  constructor(
    private sceneId: string,
    private edge: 'start' | 'end',
    private offset: number,
    private view: EditorView
  ) {
    super();
  }
  eq(other: ProseHandleWidget): boolean {
    return (
      this.sceneId === other.sceneId &&
      this.edge === other.edge &&
      this.offset === other.offset
    );
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-prose-handle cm-prose-handle-${this.edge}`;
    el.setAttribute('aria-hidden', 'true');
    el.title =
      this.edge === 'start' ? 'Drag to move scene start' : 'Drag to move scene end';
    el.setAttribute('data-testid', `handle-${this.edge}-${this.sceneId}`);
    const { view, sceneId, edge } = this;
    el.addEventListener('mousedown', (downEv: MouseEvent): void => {
      downEv.preventDefault();
      downEv.stopPropagation();
      const onMove = (moveEv: MouseEvent): void => {
        const pos = view.posAtCoords({ x: moveEv.clientX, y: moveEv.clientY }, false);
        if (pos == null) return;
        const current = view.state.field(proseHighlightField);
        const draggedEntry = current.find(
          (r: ProseHighlightRange): boolean => r.sceneId === sceneId
        );
        if (!draggedEntry) return;
        const updated = current.map((r: ProseHighlightRange): ProseHighlightRange => {
          if (r.sceneId === sceneId)
            return edge === 'start' ? { ...r, from: pos } : { ...r, to: pos };
          return r;
        });
        view.dispatch({ effects: setProseHighlightEffect.of(updated) });
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = `${edge} boundary of ${sceneId} dragged`;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    return el;
  }
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown';
  }
}

// ── highlight plugin ─────────────────────────────────────────────────────

function buildProseHighlightPlugin(): ReturnType<typeof ViewPlugin.fromClass> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate): void {
        if (
          u.state.field(proseHighlightField) !==
            u.startState.field(proseHighlightField) ||
          u.docChanged
        ) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const ranges = view.state.field(proseHighlightField);
        if (ranges.length === 0) return Decoration.none;
        const docLen = view.state.doc.length;
        const decos: ReturnType<typeof Decoration.mark>[] = [];
        const sorted = [...ranges].sort(
          (a: ProseHighlightRange, b: ProseHighlightRange): number => a.from - b.from
        );
        for (const entry of sorted) {
          const from = Math.max(0, Math.min(entry.from, docLen));
          const to = Math.max(0, Math.min(entry.to, docLen));
          if (from >= to) continue;
          decos.push(
            Decoration.widget({
              widget: new ProseHandleWidget(entry.sceneId, 'end', to, view),
              side: -1,
            }).range(to)
          );
          decos.push(
            Decoration.mark({ class: 'cm-prose-link-highlight' }).range(from, to)
          );
          decos.push(
            Decoration.widget({
              widget: new ProseHandleWidget(entry.sceneId, 'start', from, view),
              side: 1,
            }).range(from)
          );
        }
        return Decoration.set(decos, true);
      }
    },
    {
      decorations: (v: { decorations: DecorationSet }): DecorationSet => v.decorations,
    }
  );
}

// ── build editor ─────────────────────────────────────────────────────────

const markerHidePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = markerHideDecorator.createDeco(view);
    }
    update(u: ViewUpdate): void {
      this.decorations = markerHideDecorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v: { decorations: DecorationSet }): DecorationSet => v.decorations }
);

const state = EditorState.create({
  doc: content,
  extensions: [
    EditorView.lineWrapping,
    drawSelection(),
    keymap.of(defaultKeymap),
    proseHighlightField,
    buildProseHighlightPlugin(),
    markerHidePlugin,
    EditorView.theme({
      '.cm-content': {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        lineHeight: '1.6',
      },
      '.cm-prose-link-highlight': {
        backgroundColor: 'rgba(245, 158, 11, 0.40)',
        borderRadius: '2px',
        boxShadow: 'inset 0 -2px 0 rgba(180,110,0,0.45)',
      },
      '.cm-prose-handle': {
        display: 'inline-block',
        position: 'relative',
        width: '0px',
        verticalAlign: 'baseline',
        cursor: 'ew-resize',
        userSelect: 'none',
        pointerEvents: 'all',
      },
      '.cm-prose-handle::before': {
        content: '""',
        position: 'absolute',
        left: '-3px',
        top: '-0.35em',
        height: '0.7em',
        width: '6px',
        background: 'rgba(180, 100, 0, 0.50)',
        borderRadius: '3px',
      },
    }),
    EditorView.updateListener.of((update: ViewUpdate): void => {
      if (update.selectionSet) {
        const { anchor, head } = update.state.selection.main;
        const statusEl = document.getElementById('status');
        const pos = head;

        // Determine which scene (if any) the cursor is inside
        const docText = view.state.doc.toString();
        const ra = findRange(docText, 'a');
        const rb = findRange(docText, 'b');

        let activeId: string | null = null;
        if (ra && pos >= ra.from && pos < ra.to) activeId = 'a';
        else if (rb && pos >= rb.from && pos < rb.to) activeId = 'b';

        if (statusEl)
          statusEl.textContent = `Cursor: ${anchor}–${head}  scene: ${activeId ?? 'none'}`;

        // Dispatch highlight change (mimics useSceneProseSync React hook)
        const entries: ProseHighlightRange[] = [];
        if (ra) entries.push({ sceneId: 'a', ...ra });
        if (rb) entries.push({ sceneId: 'b', ...rb });
        view.dispatch({ effects: setProseHighlightEffect.of(entries) });
      }
    }),
  ],
});

const view = new EditorView({
  state,
  parent: document.getElementById('editor')!,
});

// ── expose to Playwright ─────────────────────────────────────────────────

(window as Record<string, unknown>).__editorView = view;
(window as Record<string, unknown>).__setProseHighlight = (
  entries: ProseHighlightRange[]
): void => {
  view.dispatch({ effects: setProseHighlightEffect.of(entries) });
};

// Compute and dispatch initial highlights
function findRange(docText: string, id: string): { from: number; to: number } | null {
  const startToken = sceneMarkerToken(id, 'start');
  const endToken = sceneMarkerToken(id, 'end');
  const start = docText.indexOf(startToken);
  const end = docText.indexOf(endToken);
  if (start < 0 || end < start) return null;
  return { from: start + startToken.length, to: end };
}

const docText = view.state.doc.toString();
const entries: ProseHighlightRange[] = [];
const ra = findRange(docText, 'a');
const rb = findRange(docText, 'b');
if (ra) entries.push({ sceneId: 'a', ...ra });
if (rb) entries.push({ sceneId: 'b', ...rb });
view.dispatch({ effects: setProseHighlightEffect.of(entries) });
