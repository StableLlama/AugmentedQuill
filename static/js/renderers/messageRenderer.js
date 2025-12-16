import { ROLES, UI_STRINGS } from '../constants/constants.js';
import { MarkdownRenderer } from '../markdown.js';
import { renderTemplate } from '../utils/templateLoader.js';

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
    // render messages using external templates
    renderable.forEach(async (m, idx) => {
      const isUser = m.role === ROLES.USER;
      const avatarIcon = isUser ? 'user' : 'bot';
      const rowDirectionClass = isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row';
      const avatarClass = isUser ? 'bg-indigo-900/50 text-indigo-300' : 'bg-emerald-900/50 text-emerald-400';
      if (m._editing) {
        const html = await renderTemplate('message-edit', {
          rowDirectionClass,
          avatarClass,
          avatarIcon,
          editBuffer: m._editBuffer || m.content || '',
          msgId: m._localId || m.id || ''
        });
        list.insertAdjacentHTML('beforeend', html);
        const node = list.lastElementChild;
        const ta = node.querySelector('[data-editarea]');
        if (ta) ta.addEventListener('input', (e) => { m._editBuffer = e.target.value; });
      } else {
        const bubbleContent = (m.role === ROLES.ASSISTANT)
          ? MarkdownRenderer.toHtml(String(m.content || ''))
          : `<p class="whitespace-pre-wrap">${String(m.content || '')}</p>`;
        const bubbleClass = isUser ? 'bg-indigo-600 text-white' : 'bg-stone-800 border border-stone-700 text-stone-200 shadow-sm';
        const hoverPosClass = isUser ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2';
        const html = await renderTemplate('message-bubble', {
          rowDirectionClass,
          avatarClass,
          avatarIcon,
          bubbleClass,
          hoverPosClass,
          bubbleContent: bubbleContent, // raw
          msgId: m._localId || m.id || ''
        });
        list.insertAdjacentHTML('beforeend', html);
      }
      try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
    });
    try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
    list.scrollTop = list.scrollHeight;
  }
}