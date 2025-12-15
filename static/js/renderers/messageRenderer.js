import { ROLES, UI_STRINGS } from '../constants/constants.js';
import { MarkdownRenderer } from '../markdown.js';

export class MessageRenderer {
  /**
   * Handles rendering of chat messages.
   * Separates rendering logic from chat logic to keep components modular,
   * and filters out tool messages to maintain a clean user interface focused on conversation.
   * @param {ChatView} chatView - The parent ChatView instance.
   */
  constructor(chatView) {
    this.chatView = chatView;
  }

  /**
   * Renders the chat messages.
   */
  render() {
    const list = this.chatView.$refs.chatList;
    if (!list) return;
    list.innerHTML = '';
    // Filter out tool messages from rendering to keep UI clean
    const renderable = (this.chatView.messages || []).filter(m => m.role !== ROLES.TOOL);
    if (!renderable.length) {
      const empty = document.createElement('div');
      empty.className = 'aq-empty';
      empty.textContent = UI_STRINGS.NO_MESSAGES;
      list.appendChild(empty);
      return;
    }
    renderable.forEach((m, idx) => {
      const wrap = document.createElement('div');
      wrap.className = `aq-bubble ${m.role}` + (idx === this.chatView.messages.length - 1 ? ' last' : '');
      const header = document.createElement('div');
      header.className = 'aq-bubble-head';
      header.textContent = m.role;
      const content = document.createElement('div');
      content.className = 'aq-bubble-body';
      // Clean content of tool call syntax before rendering
      let cleanContent = (m.content || '').trim();
      // Remove various tool call formats (complete and incomplete)
      cleanContent = cleanContent.replace(/<tool_call>[^<]*<\/tool_call>/gi, '');
      cleanContent = cleanContent.replace(/<function_call>[^<]*<\/function_call>/gi, '');
      cleanContent = cleanContent.replace(/\[TOOL_CALL\][^\[]*\[\/TOOL_CALL\]/gi, '');
      cleanContent = cleanContent.replace(/^Tool:\s*\w+.*$/gm, '');
      cleanContent = cleanContent.replace(/^Function:\s*\w+.*$/gm, '');
      // Remove incomplete tool call tags
      cleanContent = cleanContent.replace(/<tool_call>[^<]*$/gi, '');
      cleanContent = cleanContent.replace(/<function_call>[^<]*$/gi, '');
      cleanContent = cleanContent.replace(/\[TOOL_CALL\][^\[]*$/gi, '');
      cleanContent = cleanContent.trim();
      // Render assistant messages as basic markdown, others as plain text
      if (m.role === ROLES.ASSISTANT) {
        content.innerHTML = MarkdownRenderer.toHtml(cleanContent);
      } else {
        content.contentEditable = 'true';
        content.spellcheck = true;
        content.innerText = cleanContent;
        content.addEventListener('input', () => {
          m.content = content.innerText;
        });
      }

      const actions = document.createElement('div');
      actions.className = 'aq-bubble-actions';
      if (idx === this.chatView.messages.length - 1) {
        const del = document.createElement('button');
        del.className = 'aq-btn aq-btn-sm';
        del.textContent = UI_STRINGS.DELETE;
        del.addEventListener('click', () => this.chatView.deleteLast());
        actions.appendChild(del);
        if (m.role === ROLES.ASSISTANT) {
          const regen = document.createElement('button');
          regen.className = 'aq-btn aq-btn-sm';
          regen.textContent = UI_STRINGS.REGENERATE;
          regen.addEventListener('click', () => this.chatView.regenerate());
          actions.appendChild(regen);
        }
      }

      wrap.appendChild(header);
      wrap.appendChild(content);
      if (actions.childElementCount) wrap.appendChild(actions);
      list.appendChild(wrap);
    });
    list.scrollTop = list.scrollHeight;
  }
}