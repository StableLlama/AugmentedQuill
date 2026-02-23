// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Defines plain text editable surface for the editor so content-editable behavior is isolated and reusable.
 */

import React, { useEffect, useImperativeHandle, useRef } from 'react';

export interface PlainTextEditableProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  onChange: (value: string) => void;
  showWhitespace?: boolean;
}

export const PlainTextEditable = React.forwardRef<
  HTMLDivElement,
  PlainTextEditableProps
>(
  (
    {
      value,
      onChange,
      className,
      onKeyDown,
      onSelect,
      placeholder,
      style,
      showWhitespace = false,
      ...props
    },
    ref
  ) => {
    const elementRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => elementRef.current as HTMLDivElement);

    useEffect(() => {
      const display = showWhitespace
        ? (value || '')
            .replace(/\t/g, '→\t')
            .replace(/ /g, '·\u200b')
            .replace(/\r?\n/g, '¶\n')
        : value || '';
      if (elementRef.current && elementRef.current.innerText !== display) {
        elementRef.current.innerText = display;
      }
    }, [value, showWhitespace]);

    const onPaste = (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    };

    const fromDisplay = (s: string) => {
      return s
        .replace(/·\u200b?/g, ' ')
        .replace(/→\t/g, '\t')
        .replace(/¶\n/g, '\n');
    };

    const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
      const displayed = e.currentTarget.innerText;
      const raw = showWhitespace ? fromDisplay(displayed) : displayed;
      onChange(raw);
    };

    return (
      <div
        ref={elementRef}
        contentEditable
        className={`${className} empty:before:content-[attr(data-placeholder)] empty:before:text-inherit empty:before:opacity-40 outline-none`}
        onInput={handleInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onMouseUp={onSelect}
        onKeyUp={onSelect}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        spellCheck={false}
        style={style}
        {...props}
      />
    );
  }
);
