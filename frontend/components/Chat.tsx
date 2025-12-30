import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, AppTheme } from '../types';
import {
  Send,
  Loader2,
  Bot,
  User,
  Sparkles,
  RefreshCw,
  Trash2,
  Edit2,
  Save,
  X,
  Settings2,
} from 'lucide-react';
import { Button } from './Button';
import { MarkdownView } from './MarkdownView';

interface ChatProps {
  messages: ChatMessage[];
  isLoading: boolean;
  systemPrompt: string;
  onSendMessage: (text: string) => void;
  onRegenerate: () => void;
  onEditMessage: (id: string, newText: string) => void;
  onDeleteMessage: (id: string) => void;
  onUpdateSystemPrompt: (newPrompt: string) => void;
  theme?: AppTheme;
}

export const Chat: React.FC<ChatProps> = ({
  messages,
  isLoading,
  systemPrompt,
  onSendMessage,
  onRegenerate,
  onEditMessage,
  onDeleteMessage,
  onUpdateSystemPrompt,
  theme = 'mixed',
}) => {
  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [tempSystemPrompt, setTempSystemPrompt] = useState(systemPrompt);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isLight = theme === 'light';
  const bgMain = isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-900';
  const borderMain = isLight ? 'border-brand-gray-200' : 'border-brand-gray-800';
  const textMain = isLight ? 'text-brand-gray-800' : 'text-brand-gray-400';
  const headerBg = isLight ? 'bg-brand-gray-100' : 'bg-brand-gray-900';
  const msgUserBg = isLight
    ? 'bg-brand-600 text-white'
    : 'bg-brand-900/40 text-brand-300 border border-brand-800/50';
  const msgBotBg = isLight
    ? 'bg-brand-gray-50 border border-brand-gray-200 shadow-sm'
    : 'bg-brand-gray-800/50 border border-brand-gray-700 shadow-sm';
  const inputBg = isLight
    ? 'bg-brand-gray-50 border-brand-gray-300 text-brand-gray-900'
    : 'bg-brand-gray-950 border-brand-gray-800 text-brand-gray-300';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, editingMessageId]);

  useEffect(() => {
    setTempSystemPrompt(systemPrompt);
  }, [systemPrompt]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const startEditing = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditContent(msg.text);
  };

  const saveEdit = (id: string) => {
    if (editContent.trim()) {
      onEditMessage(id, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    }
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleSystemPromptSave = () => {
    onUpdateSystemPrompt(tempSystemPrompt);
    setShowSystemPrompt(false);
  };

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = !isLoading && lastMessage?.role === 'model';

  return (
    <div
      className={`flex flex-col h-full border-l ${bgMain} ${borderMain} ${textMain}`}
    >
      <div
        className={`p-4 border-b flex items-center justify-between ${headerBg} ${borderMain}`}
      >
        <div className="flex items-center space-x-2">
          <Sparkles className="text-brand-500" size={20} />
          <h2 className="font-semibold">Writing Partner</h2>
        </div>
        <button
          onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          className={`p-1.5 rounded hover:bg-brand-gray-200 dark:hover:bg-brand-gray-800 transition-colors ${
            showSystemPrompt
              ? 'bg-brand-gray-200 dark:bg-brand-gray-800 text-brand-600'
              : 'text-brand-gray-500'
          }`}
          title="Chat Settings"
        >
          <Settings2 size={16} />
        </button>
      </div>

      {showSystemPrompt && (
        <div
          className={`p-4 border-b animate-in slide-in-from-top-2 ${bgMain} ${borderMain}`}
        >
          <label className="block text-xs font-medium text-brand-gray-500 uppercase tracking-wider mb-2">
            System Instruction
          </label>
          <textarea
            value={tempSystemPrompt}
            onChange={(e) => setTempSystemPrompt(e.target.value)}
            className={`w-full h-32 rounded-md p-3 text-sm focus:ring-1 focus:ring-brand-500 focus:outline-none resize-none mb-3 border ${inputBg}`}
            placeholder="Define the AI's persona and rules..."
          />
          <div className="flex justify-end space-x-2">
            <Button
              theme={theme}
              size="sm"
              variant="ghost"
              onClick={() => setShowSystemPrompt(false)}
              theme={theme}
            >
              Cancel
            </Button>
            <Button
              theme={theme}
              size="sm"
              variant="primary"
              onClick={handleSystemPromptSave}
              theme={theme}
            >
              Update Persona
            </Button>
          </div>
        </div>
      )}

      <div
        className={`flex-1 overflow-y-auto p-4 space-y-4 ${
          isLight ? 'bg-brand-gray-50' : 'bg-brand-gray-950/30'
        }`}
      >
        {messages.length === 0 && !showSystemPrompt && (
          <div className="text-center text-brand-gray-500 mt-10 p-4">
            <Bot className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-sm">
              I'm your AI co-author. Ask me to write, edit, or brainstorm ideas for your
              story!
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`group flex items-start space-x-3 ${
              msg.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
            }`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border mt-1 ${
                msg.role === 'user'
                  ? 'bg-brand-100 border-brand-200 text-brand-700'
                  : isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200 text-brand-gray-500'
                  : 'bg-brand-gray-800 border-brand-gray-700 text-brand-gray-400'
              }`}
            >
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>

            <div className={`flex-1 max-w-[85%] relative`}>
              {editingMessageId === msg.id ? (
                <div
                  className={`border rounded-lg p-3 shadow-lg ${
                    isLight
                      ? 'bg-brand-gray-50 border-brand-gray-200'
                      : 'bg-brand-gray-800 border-brand-gray-600'
                  }`}
                >
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={`w-full text-sm p-2 rounded border focus:outline-none focus:border-brand-500 min-h-[100px] ${inputBg}`}
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-brand-gray-400 hover:text-brand-gray-600"
                    >
                      <X size={14} />
                    </button>
                    <button
                      onClick={() => saveEdit(msg.id)}
                      className="p-1 text-brand-500 hover:opacity-80"
                    >
                      <Save size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`rounded-lg p-3 text-sm leading-relaxed ${
                    msg.role === 'user' ? msgUserBg : msgBotBg
                  }`}
                >
                  <MarkdownView content={msg.text} />
                </div>
              )}

              {!editingMessageId && !isLoading && (
                <div
                  className={`absolute top-0 ${
                    msg.role === 'user'
                      ? 'left-0 -translate-x-full pr-2'
                      : 'right-0 translate-x-full pl-2'
                  } opacity-0 group-hover:opacity-100 transition-opacity flex flex-col space-y-1`}
                >
                  <button
                    onClick={() => startEditing(msg)}
                    className="p-1 text-brand-gray-400 hover:text-brand-gray-600 bg-brand-gray-950/5 rounded"
                    title="Edit"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => onDeleteMessage(msg.id)}
                    className="p-1 text-brand-gray-400 hover:text-red-500 bg-brand-gray-950/5 rounded"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-3">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-900/30 border-brand-gray-800'
              }`}
            >
              <Bot size={16} className="text-brand-gray-400" />
            </div>
            <div
              className={`px-4 py-2 rounded-lg shadow-sm border ${
                isLight
                  ? 'bg-brand-gray-50 border-brand-gray-200'
                  : 'bg-brand-gray-800 border-brand-gray-700'
              }`}
            >
              <Loader2 className="animate-spin text-brand-500" size={16} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={`p-4 border-t ${bgMain} ${borderMain}`}>
        {canRegenerate && (
          <div className="flex justify-center mb-4">
            <Button
              theme={theme}
              size="sm"
              variant="secondary"
              onClick={onRegenerate}
              icon={<RefreshCw size={12} />}
              className="text-xs py-1 h-7 border-dashed"
              theme={theme}
            >
              Regenerate last response
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your instruction..."
            className={`w-full pl-4 pr-12 py-3 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all text-sm placeholder-brand-gray-400 border ${inputBg}`}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-brand-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-brand-gray-200 dark:hover:bg-brand-gray-700 rounded-full transition-colors"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};
