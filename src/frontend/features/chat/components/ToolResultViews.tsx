// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines specialized chat tool result views for web-search and page-visit responses.
 */

import React from 'react';
import { ArrowRight, Globe } from 'lucide-react';
import { MarkdownView } from '../../editor/MarkdownView';

type SearchResult = {
  title?: string;
  href?: string;
  url?: string;
  body?: string;
  snippet?: string;
};

export const WebSearchResults: React.FC<{ content: string; name: string }> = ({
  content,
  name,
}) => {
  try {
    const data = JSON.parse(content);
    const results = Array.isArray(data) ? data : data.results || [];
    const query = data.query || '';

    return (
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 pb-2 border-b border-blue-500/20">
          <Globe className="text-blue-500" size={16} />
          <span className="font-bold text-xs text-blue-700 dark:text-blue-400">
            {name === 'wikipedia_search' ? 'Wikipedia:' : 'Web Search:'}
          </span>
          <span className="italic text-brand-gray-600 dark:text-brand-gray-400 text-xs truncate">
            "{query}"
          </span>
        </div>

        {results.length === 0 ? (
          <div className="text-[11px] text-brand-gray-500 italic py-2">
            {data.error ? `Error: ${data.error}` : 'No relevant results found.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 py-2">
            {results.map((result: SearchResult, index: number) => (
              <div
                key={index}
                className="group flex flex-col p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-blue-500/20"
              >
                <a
                  href={result.href || result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-semibold text-sm line-clamp-1"
                >
                  {result.title}
                </a>
                <div className="text-[10px] text-green-700 dark:text-green-500 truncate mt-0.5">
                  {result.href || result.url}
                </div>
                {result.body || result.snippet ? (
                  <div className="text-brand-gray-600 dark:text-brand-gray-300 text-[11px] line-clamp-2 mt-1 leading-snug">
                    {result.body || result.snippet}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } catch {
    return <MarkdownView content={content} />;
  }
};

export const VisitPageResult: React.FC<{ content: string }> = ({ content }) => {
  try {
    const data = JSON.parse(content);
    return (
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2 pb-2 border-b border-amber-500/20">
          <ArrowRight className="text-amber-500" size={14} />
          <span className="font-bold text-xs text-amber-700 dark:text-amber-400">
            Visited Page:
          </span>
        </div>

        <div className="bg-amber-500/5 border border-amber-500/10 rounded p-2 text-[10px] text-brand-gray-500 break-all font-mono">
          {data.url}
        </div>

        {data.error ? (
          <div className="text-[11px] text-red-500 italic p-1">
            Error loading page: {data.error}
          </div>
        ) : (
          <div className="bg-white/80 dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-lg p-3">
            <div className="max-h-80 overflow-y-auto custom-scrollbar text-[11px] whitespace-pre-wrap opacity-90 font-sans leading-relaxed">
              {data.content}
            </div>
            <div className="mt-2 text-right">
              <span className="text-[9px] text-brand-gray-400 uppercase tracking-wider">
                Extracted Text ({Math.round(data.content.length / 1024)} KB)
              </span>
            </div>
          </div>
        )}
      </div>
    );
  } catch {
    return <MarkdownView content={content} />;
  }
};
