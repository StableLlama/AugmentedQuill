import { UI_STRINGS } from '../constants/constants.js';

export class RoleSelector {
  /**
   * Handles role selection for chat messages.
   * Allows users to specify message roles (user/assistant/system) to control conversation flow,
   * enabling more precise interactions with the AI for different use cases.
   * @param {ChatView} chatView - The parent ChatView instance.
   */
  constructor(chatView) {
    this.chatView = chatView;
  }

  /**
   * Binds events for the role selector.
   */
  bindEvents() {
    const roleBtn = this.chatView.$refs.roleButton;
    const roleMenu = this.chatView.$refs.roleMenu;
    if (roleBtn && roleMenu) {
      roleBtn.addEventListener('click', () => {
        const open = roleMenu.hasAttribute('hidden') ? false : true;
        if (open) roleMenu.setAttribute('hidden', ''); else roleMenu.removeAttribute('hidden');
        roleBtn.setAttribute('aria-expanded', (!open).toString());
      });
      roleMenu.querySelectorAll('button[data-role]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = btn.getAttribute('data-role');
          if (r) {
            this.chatView.inputRole = r;
            roleBtn.textContent = r + ' ▾';
          }
          roleMenu.setAttribute('hidden', '');
          roleBtn.setAttribute('aria-expanded', 'false');
        });
      });
      document.addEventListener('click', (ev) => {
        if (!this.chatView.el.contains(ev.target)) return;
        if (!roleMenu.contains(ev.target) && ev.target !== roleBtn) {
          roleMenu.setAttribute('hidden', '');
          roleBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }
}