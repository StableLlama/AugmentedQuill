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
      const isUser = m.role === ROLES.USER;
      const container = document.createElement('div');
      container.className = `group flex items-start space-x-3 ${isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`;

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = `flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border border-stone-700 mt-1 ${isUser ? 'bg-indigo-900/50 text-indigo-300' : 'bg-emerald-900/50 text-emerald-400'}`;
      avatar.innerHTML = isUser
        ? '<i data-lucide="user"></i>'
        : '<i data-lucide="bot"></i>';

      // Message body wrapper
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'flex-1 max-w-[85%] relative';

      // Editing mode
      if (m._editing) {
        const editPanel = document.createElement('div');
        editPanel.className = 'bg-stone-800 border border-stone-600 rounded-lg p-3 shadow-lg';
        const ta = document.createElement('textarea');
        ta.className = 'w-full bg-stone-900 text-stone-200 text-sm p-2 rounded border border-stone-700 focus:outline-none min-h-[100px]';
        ta.value = m._editBuffer || m.content || '';
        ta.addEventListener('input', (e) => { m._editBuffer = e.target.value; });
        editPanel.appendChild(ta);
        const controls = document.createElement('div');
        controls.className = 'flex justify-end space-x-2 mt-2';
        const cancel = document.createElement('button');
        cancel.className = 'p-1 text-stone-400 hover:text-stone-200';
        cancel.setAttribute('data-action', 'cancel-edit');
        cancel.setAttribute('data-msg-id', m._localId || m.id || '');
        cancel.innerHTML = '<i data-lucide="x"></i>';
        const save = document.createElement('button');
        save.className = 'p-1 text-emerald-500 hover:text-emerald-400';
        save.setAttribute('data-action', 'save-edit');
        save.setAttribute('data-msg-id', m._localId || m.id || '');
        save.innerHTML = '<i data-lucide="save"></i>';
        controls.appendChild(cancel);
        controls.appendChild(save);
        editPanel.appendChild(controls);
        bodyWrap.appendChild(editPanel);
      } else {
        const bubble = document.createElement('div');
        bubble.className = `rounded-lg p-3 text-sm leading-relaxed ${isUser ? 'bg-indigo-600 text-white' : 'bg-stone-800 border border-stone-700 text-stone-200 shadow-sm'}`;
        if (m.role === ROLES.ASSISTANT) {
          bubble.innerHTML = MarkdownRenderer.toHtml(String(m.content || ''));
        } else {
          const p = document.createElement('p');
          p.className = 'whitespace-pre-wrap';
          p.textContent = m.content || '';
          bubble.appendChild(p);
        }
        bodyWrap.appendChild(bubble);
      }

      // Hover actions (edit/delete)
      if (!m._editing) {
        const actions = document.createElement('div');
        actions.className = `absolute top-0 ${isUser ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} opacity-0 group-hover:opacity-100 transition-opacity flex flex-col space-y-1`;
        const edit = document.createElement('button');
        edit.className = 'p-1 text-stone-500 hover:text-stone-300 bg-stone-900/50 rounded';
        edit.setAttribute('title', 'Edit');
        edit.setAttribute('data-action', 'edit-message');
        edit.setAttribute('data-msg-id', m._localId || m.id || '');
        edit.innerHTML = '<i data-lucide="pen"></i>';
        const del = document.createElement('button');
        del.className = 'p-1 text-stone-500 hover:text-red-400 bg-stone-900/50 rounded';
        del.setAttribute('title', 'Delete');
        del.setAttribute('data-action', 'delete-message');
        del.setAttribute('data-msg-id', m._localId || m.id || '');
        del.innerHTML = '<i data-lucide="trash-2"></i>';
        actions.appendChild(edit);
        actions.appendChild(del);
        bodyWrap.appendChild(actions);
      }

      container.appendChild(avatar);
      container.appendChild(bodyWrap);
      list.appendChild(container);
      try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
    });
    try { if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch (_) {}
    list.scrollTop = list.scrollHeight;
  }
}