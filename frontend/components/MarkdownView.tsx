import React from 'react';
import { AlertTriangle, Image as ImageIcon, Link as LinkIcon } from 'lucide-react';

interface MarkdownViewProps {
  content: string;
  className?: string;
  simple?: boolean; // If true, only highlights bold/italic
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '', simple = false }) => {
  
  const renderLine = (line: string, i: number) => {
    // Headers
    const headerMatch = line.match(/^(#{1,6})(\s)(.*)/);
    if (headerMatch && !simple) {
      const level = headerMatch[1].length;
      const sizeClass = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : 'text-lg';
      return (
        <div key={i} className={`font-bold text-amber-700/90 ${sizeClass} mt-4 mb-2`}>
          <span className="text-amber-500/40 font-mono text-sm mr-1">{headerMatch[1]}</span>
          {renderInline(headerMatch[3])}
        </div>
      );
    }

    // Blockquotes
    const quoteMatch = line.match(/^(\>+)(\s)(.*)/);
    if (quoteMatch && !simple) {
       return (
        <div key={i} className="text-stone-500 italic pl-3 border-l-4 border-stone-600/30 my-2">
          <span className="text-stone-700/30 select-none mr-1">{quoteMatch[1]}</span>
          {renderInline(quoteMatch[3])}
        </div>
       );
    }
    
    // Unordered Lists
    const ulMatch = line.match(/^(\s*[-*+])(\s)(.*)/);
    if (ulMatch && !simple) {
        return (
            <div key={i} className="pl-4 relative">
                <span className="absolute left-0 text-amber-600 font-bold font-mono">{ulMatch[1]}</span>
                <span className="ml-4">{renderInline(ulMatch[3])}</span>
            </div>
        );
    }

    // Ordered Lists
    const olMatch = line.match(/^(\s*\d+\.)(\s)(.*)/);
    if (olMatch && !simple) {
        return (
            <div key={i} className="pl-4 relative">
                <span className="absolute left-0 text-amber-600 font-bold font-mono">{olMatch[1]}</span>
                <span className="ml-5">{renderInline(olMatch[3])}</span>
            </div>
        );
    }

    // Image (Standalone line)
    const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch && !simple) {
         return (
             <div key={i} className="my-2 p-2 bg-stone-900/50 rounded border border-stone-800 flex items-center gap-2 text-stone-400 text-sm font-mono">
                 <ImageIcon size={14} className="text-amber-500"/>
                 <span className="text-stone-500">![</span>
                 <span className="text-stone-300">{imgMatch[1]}</span>
                 <span className="text-stone-500">](</span>
                 <span className="text-blue-400 underline truncate max-w-[200px]">{imgMatch[2]}</span>
                 <span className="text-stone-500">)</span>
             </div>
         )
    }

    // Footnote Definition
    const fnMatch = line.match(/^(\[\^.*?\]:)(\s)(.*)/);
    if (fnMatch && !simple) {
        return (
            <div key={i} className="text-xs text-stone-500 mt-1">
                <span className="text-amber-600 font-mono">{fnMatch[1]}</span>
                {renderInline(fnMatch[3])}
            </div>
        )
    }

    return <div key={i} className="min-h-[1.5em]">{renderInline(line)}</div>;
  };

  const renderInline = (text: string) => {
    if (!text) return null;
    
    // Tokenizer regex for inline elements
    // Order matters! 
    // 1. Image: ![alt](src)
    // 2. Link: [text](src)
    // 3. Bold: **text** or __text__
    // 4. Italic: *text* or _text_
    // 5. Code: `text`
    // 6. Footnote Ref: [^1]
    
    const regex = /(!\[.*?\]\(.*?\)|\[\^.*?\]|\[.*?\]\(.*?\)|`.*?`|\*\*.*?\*\*|__.*?__|\*.*?\*|_.*?_)/g;
    const parts = text.split(regex);
    
    return parts.map((part, index) => {
        if (!part) return null;

        // Image Inline
        if (part.startsWith('![') && part.includes('](') && part.endsWith(')')) {
            return <span key={index} className="text-stone-400 font-mono text-sm bg-stone-800/50 rounded px-1">{part}</span>;
        }

        // Link
        if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
             // Extract text and url for better highlighting if needed, but keeping it simple/visible
             return <span key={index} className="text-amber-600 underline decoration-amber-600/30">{part}</span>;
        }

        // Footnote Ref
        if (part.startsWith('[^') && part.endsWith(']')) {
             return <sup key={index} className="text-amber-600 font-mono text-xs">{part}</sup>;
        }

        // Bold
        if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
            return <span key={index} className="font-bold text-amber-700">{part}</span>;
        }
        
        // Italic
        if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
             return <span key={index} className="italic text-amber-600">{part}</span>;
        }

        // Code
        if (part.startsWith('`') && part.endsWith('`') && !simple) {
            return <span key={index} className="font-mono text-stone-400 bg-stone-800 rounded px-1 text-sm">{part}</span>;
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
    <div className="inline-flex items-center space-x-1 text-amber-500 bg-amber-950/30 px-2 py-1 rounded text-[10px] border border-amber-500/20 ml-2" title="Summaries should mostly use Bold and Italic. Other formatting might distract.">
        <AlertTriangle size={10} />
        <span>Complex formatting detected</span>
    </div>
);