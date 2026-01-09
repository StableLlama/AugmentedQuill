import React from 'react';
import { AlertTriangle } from 'lucide-react';
// @ts-ignore
import { marked } from 'marked';

interface MarkdownViewProps {
  content: string;
  className?: string;
  simple?: boolean; // If true, only highlights bold/italic, shows source for others
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  className = '',
  simple = false,
}) => {
  if (!simple) {
    return (
      <div
        className={`prose-editor whitespace-normal ${className}`}
        dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
      />
    );
  }

  const renderLine = (line: string, i: number) => {
    // In simple mode, we still show the markdown for headers/lists etc but warn via the parent
    return (
      <div key={i} className="min-h-[1.5em]">
        {renderInline(line)}
      </div>
    );
  };

  const renderInline = (text: string) => {
    if (!text) return null;

    // Tokenizer regex for inline elements
    const regex = /(`.*?`|\*\*.*?\*\*|__.*?__|\*.*?\*|_.*?_)/g;
    const parts = text.split(regex);

    return parts.map((part, index) => {
      if (!part) return null;

      // Bold
      if (
        (part.startsWith('**') && part.endsWith('**')) ||
        (part.startsWith('__') && part.endsWith('__'))
      ) {
        return (
          <span key={index} className="font-bold">
            {part.slice(2, -2)}
          </span>
        );
      }

      // Italic
      if (
        (part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))
      ) {
        return (
          <span key={index} className="italic">
            {part.slice(1, -1)}
          </span>
        );
      }

      // Code
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <span
            key={index}
            className="font-mono text-brand-gray-400 bg-brand-gray-800 rounded px-1 text-sm"
          >
            {part.slice(1, -1)}
          </span>
        );
      }

      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className={`whitespace-pre-wrap break-words ${className}`}>
      {content.split('\n').map((line, i) => renderLine(line, i))}
    </div>
  );
};

export const hasUnsupportedSummaryMarkdown = (text: string): boolean => {
  const lines = text.split('\n');
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) return true;
    if (/^>\s/.test(line)) return true;
    if (/^[-*+]\s/.test(line)) return true;
    if (/^\d+\.\s/.test(line)) return true;
  }
  if (/`[^`]+`/.test(text)) return true;
  if (/\[.*?\]\(.*?\)/.test(text)) return true;
  return false;
};

export const SummaryWarning: React.FC = () => (
  <div
    className="inline-flex items-center space-x-1 text-brand-500 bg-brand-950/30 px-2 py-1 rounded text-[10px] border border-brand-500/20 ml-2"
    title="Summaries should mostly use Bold and Italic. Other formatting might distract."
  >
    <AlertTriangle size={10} />
    <span>Complex formatting detected</span>
  </div>
);
