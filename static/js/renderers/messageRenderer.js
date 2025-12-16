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

    // Filter out tool messages from rendering to keep UI clean
    const renderable = (this.chatView.messages || []).filter(m => m.role !== ROLES.TOOL);

    if (!renderable.length) {
      list.innerHTML = `
        <div class="text-center text-stone-600 mt-10 p-4">
          <i data-lucide="bot" class="mx-auto mb-3 opacity-50" style="width:40px;height:40px"></i>
          <p class="text-sm">I'm your AI co-author. Ask me to write, edit, or brainstorm ideas for your story!</p>
        </div>
      `;
      try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
      return;
    }

    Promise.all(renderable.map(async (m) => {
      const isUser = m.role === ROLES.USER;
      const isAssistant = m.role === ROLES.ASSISTANT || String(m.role) === 'model';
      const avatarIcon = isUser ? 'user' : 'bot';
      const rowDirectionClass = isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row';
      const avatarClass = isUser ? 'bg-indigo-900/50 text-indigo-300' : 'bg-emerald-900/50 text-emerald-400';
      const msgId = m._localId || m.id || '';

      if (m._editing) {
        return renderTemplate('message-edit', {
          rowDirectionClass,
          avatarClass,
          avatarIcon,
          editBuffer: m._editBuffer || m.content || '',
          msgId,
        });
      }

      const bubbleContent = isAssistant
        ? `<div class="prose prose-sm prose-invert max-w-none">${MarkdownRenderer.toHtml(String(m.content || ''))}</div>`
        : `<p class="whitespace-pre-wrap">${String(m.content || '')}</p>`;

      const bubbleClass = isUser ? 'bg-indigo-600 text-white' : 'bg-stone-800 border border-stone-700 text-stone-200 shadow-sm';
      const hoverPosClass = isUser ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2';
      const controlsClass = this.chatView.sending ? 'hidden' : '';

      return renderTemplate('message-bubble', {
        rowDirectionClass,
        avatarClass,
        avatarIcon,
        bubbleClass,
        hoverPosClass,
        bubbleContent, // raw
        msgId,
        controlsClass,
      });
    }))
      .then((parts) => {
        list.innerHTML = parts.join('');

        // Wire edit buffer updates (after DOM is inserted)
        for (const m of renderable) {
          if (!m._editing) continue;
          const msgId = String(m._localId || m.id || '');
          if (!msgId) continue;
          const ta = list.querySelector(`[data-editarea][data-msg-id="${CSS.escape(msgId)}"]`);
          if (ta && !ta.__aq_bound) {
            ta.addEventListener('input', (e) => { m._editBuffer = e.target.value; });
            ta.__aq_bound = true;
          }
        }

        try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
        list.scrollTop = list.scrollHeight;
      })
      .catch((e) => {
        console.error('Failed to render chat messages:', e);
      });
  }
}