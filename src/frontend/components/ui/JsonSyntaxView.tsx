// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Shared component for readable JSON rendering with lightweight
 * syntax colouring for chat and debug payloads.
 */

import React from 'react';

type JsonSyntaxViewProps = {
  data: unknown;
  className?: string;
};

const escapeJsonString = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');

const renderJsonValue = (value: unknown, indent: number = 0): React.ReactNode => {
  if (value === null) {
    return <span className="text-orange-300">null</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-brand-gray-400">[]</span>;
    }

    return (
      <>
        <span className="text-brand-gray-400">[</span>
        {value.map((item: unknown, index: number) => (
          <React.Fragment key={index}>
            {'\n'}
            <span className="whitespace-pre">{'  '.repeat(indent + 1)}</span>
            {renderJsonValue(item, indent + 1)}
            {index < value.length - 1 && <span className="text-brand-gray-400">,</span>}
          </React.Fragment>
        ))}
        {'\n'}
        <span className="whitespace-pre">{'  '.repeat(indent)}</span>
        <span className="text-brand-gray-400">]</span>
      </>
    );
  }

  if (typeof value === 'object') {
    const entries = value ? Object.entries(value as Record<string, unknown>) : [];
    if (entries.length === 0) {
      return <span className="text-brand-gray-400">{'{}'}</span>;
    }

    return (
      <>
        <span className="text-brand-gray-400">{'{'}</span>
        {entries.map(([key, child]: [string, unknown], index: number) => (
          <React.Fragment key={key}>
            {'\n'}
            <span className="whitespace-pre">{'  '.repeat(indent + 1)}</span>
            <span className="text-sky-400">"{key}"</span>
            <span className="text-brand-gray-400">: </span>
            {renderJsonValue(child, indent + 1)}
            {index < entries.length - 1 && (
              <span className="text-brand-gray-400">,</span>
            )}
          </React.Fragment>
        ))}
        {'\n'}
        <span className="whitespace-pre">{'  '.repeat(indent)}</span>
        <span className="text-brand-gray-400">{'}'}</span>
      </>
    );
  }

  if (typeof value === 'string') {
    return (
      <span className="text-emerald-400">&quot;{escapeJsonString(value)}&quot;</span>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-orange-300">{String(value)}</span>;
  }

  return <span className="text-brand-gray-300">{String(value)}</span>;
};

export const JsonSyntaxView: React.FC<JsonSyntaxViewProps> = ({
  data,
  className,
}: JsonSyntaxViewProps) => {
  return (
    <div
      className={`whitespace-pre-wrap break-all font-mono text-[11px] ${className ?? ''}`}
    >
      {renderJsonValue(data)}
    </div>
  );
};
