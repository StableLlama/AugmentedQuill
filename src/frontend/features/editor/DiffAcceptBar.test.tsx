// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Purpose: Tests for the DiffAcceptBar floating diff action toolbar.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../app/i18n';
import { DiffAcceptBar } from './DiffAcceptBar';

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

afterEach(() => {
  cleanup();
});

describe('DiffAcceptBar', () => {
  it('renders accept and reject buttons', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    wrap(<DiffAcceptBar theme="mixed" onAccept={onAccept} onReject={onReject} />);

    expect(screen.getByLabelText('Accept change')).toBeTruthy();
    expect(screen.getByLabelText('Reject change')).toBeTruthy();
  });

  it('calls onAccept when accept button is clicked', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    wrap(<DiffAcceptBar theme="mixed" onAccept={onAccept} onReject={onReject} />);

    fireEvent.click(screen.getByLabelText('Accept change'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('calls onReject when reject button is clicked', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    wrap(<DiffAcceptBar theme="mixed" onAccept={onAccept} onReject={onReject} />);

    fireEvent.click(screen.getByLabelText('Reject change'));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does not render accept-all button by default', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();

    wrap(<DiffAcceptBar theme="mixed" onAccept={onAccept} onReject={onReject} />);

    expect(screen.queryByLabelText('Accept all changes')).toBeNull();
  });

  it('renders accept-all button when showAcceptAll is true', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onAcceptAll = vi.fn();

    wrap(
      <DiffAcceptBar
        theme="mixed"
        onAccept={onAccept}
        onReject={onReject}
        onAcceptAll={onAcceptAll}
        showAcceptAll={true}
      />
    );

    expect(screen.getByLabelText('Accept all changes')).toBeTruthy();
  });

  it('requires double-click confirmation for accept-all', () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onAcceptAll = vi.fn();

    wrap(
      <DiffAcceptBar
        theme="mixed"
        onAccept={onAccept}
        onReject={onReject}
        onAcceptAll={onAcceptAll}
        showAcceptAll={true}
      />
    );

    const btn = screen.getByLabelText('Accept all changes');
    fireEvent.click(btn);
    expect(onAcceptAll).not.toHaveBeenCalled();

    // Second click confirms
    fireEvent.click(btn);
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it('applies light theme classes', () => {
    const { container } = wrap(
      <DiffAcceptBar
        theme="light"
        onAccept={vi.fn()}
        onReject={vi.fn()}
        data-testid="diff-bar"
      />
    );

    const acceptBtn = screen.getByLabelText('Accept change');
    expect(acceptBtn.className).toContain('text-green-600');
    const rejectBtn = screen.getByLabelText('Reject change');
    expect(rejectBtn.className).toContain('text-red-600');
  });
});
