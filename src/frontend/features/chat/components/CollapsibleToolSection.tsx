// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines a reusable collapsible section for chat tool/debug payload rendering.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export const CollapsibleToolSection: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}> = ({ title, children, defaultExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <div className="mt-2 border border-black/10 dark:border-white/10 rounded overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-2 py-1 bg-black/5 dark:bg-black/20 hover:bg-black/10 dark:hover:bg-black/30 transition-colors text-[10px] font-mono text-brand-gray-500"
      >
        <span className="flex items-center gap-1">
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {title}
        </span>
      </button>
      {isExpanded && <div className="p-2 bg-transparent">{children}</div>}
    </div>
  );
};
