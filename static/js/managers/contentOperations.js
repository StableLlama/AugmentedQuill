/**
 * Content Operations
 * Handles text manipulation operations for the raw text editor.
 */
export class ContentOperations {
  /**
   * @param {ShellView} shellView - The parent ShellView instance
   */
  constructor(shellView) {
    this.shellView = shellView;
  }

  /**
   * Replace selected text with before/after strings
   */
  _replaceSelection(before, after) {
    const textarea = this.shellView.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = this.shellView.content.slice(start, end);

    this.shellView.content =
      this.shellView.content.slice(0, start) +
      before + selected + after +
      this.shellView.content.slice(end);

    setTimeout(() => {
      textarea.focus();
      const newPosition = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(newPosition, newPosition);
    }, 0);

    this.shellView.onChanged();
  }

  /**
   * Wrap selected text with before/after strings
   */
  wrapSelection(before, after) {
    this._replaceSelection(before, after);
  }

  /**
   * Insert heading at current line
   */
  insertHeading(level = 1) {
    const textarea = this.shellView.getRawEl();
    if (!textarea) return;

    const lvl = Math.max(1, Math.min(6, Number(level) || 1));
    const hashes = '#'.repeat(lvl) + ' ';

    const caretPos = textarea.selectionStart || 0;
    const lineStart = this.shellView.content.lastIndexOf('\n', caretPos - 1) + 1;

    this.shellView.content =
      this.shellView.content.slice(0, lineStart) +
      hashes +
      this.shellView.content.slice(lineStart);

    this.shellView.onChanged();
  }

  /**
   * Insert link at cursor position
   */
  insertLink() {
    const textarea = this.shellView.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = this.shellView.content.slice(start, end) || 'text';

    const url = prompt('Enter URL', 'https://');
    if (url === null) return; // User cancelled

    const linkMarkdown = `[${selected}](${url || ''})`;
    this.shellView.content =
      this.shellView.content.slice(0, start) +
      linkMarkdown +
      this.shellView.content.slice(end);

    this.shellView.onChanged();
  }

  /**
   * Toggle prefix on selected lines
   */
  togglePrefix(prefix) {
    const textarea = this.shellView.getRawEl();
    if (!textarea) return;

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const lines = this.shellView.content.split(/\r?\n/);

    const startLineIdx = this._findLineIndex(lines, start);
    const endLineIdx = this._findLineIndex(lines, end);

    for (let i = startLineIdx; i <= endLineIdx; i++) {
      if (lines[i].startsWith(prefix)) {
        lines[i] = lines[i].slice(prefix.length);
      } else {
        lines[i] = prefix + lines[i];
      }
    }

    this.shellView.content = lines.join('\n');
    this.shellView.onChanged();
  }

  /**
   * Find line index for given offset
   */
  _findLineIndex(lines, offset) {
    let position = 0;
    for (let i = 0; i < lines.length; i++) {
      if (position + lines[i].length >= offset) {
        return i;
      }
      position += lines[i].length + 1; // +1 for newline
    }
    return lines.length - 1;
  }

  /**
   * Toggle list prefix on selected lines
   */
  toggleList(prefix = '- ') {
    this.togglePrefix(prefix);
  }
}