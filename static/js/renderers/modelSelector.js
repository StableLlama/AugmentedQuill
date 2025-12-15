import { UI_STRINGS } from '../constants/constants.js';

export class ModelSelector {
  /**
   * Manages model selection UI.
   * Provides a user-friendly interface for choosing AI models,
   * displaying available options and handling selection changes to update the chat system.
   * @param {ChatView} chatView - The parent ChatView instance.
   */
  constructor(chatView) {
    this.chatView = chatView;
  }

  /**
   * Renders the model selection dropdown.
   */
  render() {
    const sel = this.chatView.$refs.modelSelect;
    if (!sel) return;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = this.chatView.models.length ? UI_STRINGS.CHOOSE_MODEL : UI_STRINGS.NO_MODELS;
    sel.appendChild(placeholder);
    this.chatView.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name || m;
      opt.textContent = (m.name || m) + (m.remote_model ? ` → ${m.remote_model}` : (m.model ? ` → ${m.model}` : ''));
      if ((m.name || m) === this.chatView.selectedName) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}