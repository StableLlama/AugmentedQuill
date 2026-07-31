// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for SceneTemporalDialog author-focused Temporal UX.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../app/i18n';
import { SceneTemporalDialog } from './SceneTemporalDialog';
import { parseZonedDateTime, toEraYear } from '../../utils/temporal';

vi.mock('../layout/ThemeContext', () => ({
  useThemeClasses: vi.fn(() => ({
    bg: '',
    text: '',
    border: '',
    muted: '',
    input: '',
  })),
}));

const wrap = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SceneTemporalDialog', () => {
  it('offers multiple region choices beyond UTC', () => {
    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    const allRegionSelects = screen.getAllByRole('combobox');
    const regionSelect = allRegionSelects.find((el: HTMLElement) =>
      Array.from((el as HTMLSelectElement).options).some(
        (option: HTMLOptionElement) => option.value === 'Europe/Paris'
      )
    );

    expect(regionSelect).toBeTruthy();
    expect(
      Array.from((regionSelect as HTMLSelectElement).options).some(
        (option: HTMLOptionElement) => option.value === 'America/New_York'
      )
    ).toBe(true);
  });

  it('builds and applies BCE dates with selected time zone', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={onClose}
        onApply={onApply}
      />
    );

    fireEvent.change(screen.getByLabelText(/Era/i), { target: { value: 'BCE' } });
    fireEvent.change(screen.getByLabelText(/Year/i), { target: { value: '44' } });
    fireEvent.change(screen.getByLabelText(/Month/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Day/i), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText(/Second/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/Common Regions/i), {
      target: { value: 'Europe/Rome' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Scene Time/i }));
    });

    expect(onApply).toHaveBeenCalledOnce();
    const appliedValue = onApply.mock.calls[0][0] as string;
    expect(appliedValue).toContain('[Europe/Rome]');

    const parsed = parseZonedDateTime(appliedValue);
    expect(parsed).toBeTruthy();
    const eraYear = toEraYear(parsed!.year);
    expect(eraYear.era).toBe('BCE');
    expect(eraYear.yearOfEra).toBe(44);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Gregorian builder input separate from scene calendar style', async () => {
    const onApply = vi.fn();

    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={onApply}
      />
    );

    fireEvent.change(screen.getByLabelText(/Calendar Style/i), {
      target: { value: 'japanese' },
    });
    fireEvent.change(screen.getByLabelText(/^Era$/i), { target: { value: 'CE' } });
    fireEvent.change(screen.getByLabelText(/^Year$/i), { target: { value: '2026' } });
    fireEvent.change(screen.getByLabelText(/Month/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Day/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Second/i), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Common Regions/i), {
      target: { value: 'UTC' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Scene Time/i }));
    });

    expect(onApply).toHaveBeenCalledOnce();
    const appliedValue = onApply.mock.calls[0][0] as string;
    const parsed = parseZonedDateTime(appliedValue);
    expect(parsed).toBeTruthy();
    expect(parsed?.calendarId).toBe('japanese');
    const gregory = parsed?.withCalendar('gregory');
    expect(gregory?.year).toBe(2026);
    expect(gregory?.month).toBe(5);
    expect(gregory?.day).toBe(10);
  });

  it('supports calendar-style input mode without BCE/CE controls', () => {
    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/Interpret Builder As/i), {
      target: { value: 'calendarStyle' },
    });

    expect(screen.queryByLabelText(/^Era$/i)).toBeNull();
    expect(screen.queryByLabelText(/^Year$/i)).toBeNull();
    expect(screen.getByLabelText(/Calendar Year/i)).toBeTruthy();
  });

  it('accepts negative signed years in calendar-style input mode', async () => {
    const onApply = vi.fn();

    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={onApply}
      />
    );

    fireEvent.change(screen.getByLabelText(/Interpret Builder As/i), {
      target: { value: 'calendarStyle' },
    });
    fireEvent.change(screen.getByLabelText(/Calendar Year/i), {
      target: { value: '-122' },
    });
    fireEvent.change(screen.getByLabelText(/Month/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Day/i), { target: { value: '15' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Scene Time/i }));
    });

    expect(onApply).toHaveBeenCalledOnce();
    const appliedValue = onApply.mock.calls[0][0] as string;
    const parsed = parseZonedDateTime(appliedValue);
    expect(parsed?.year).toBe(-122);
    expect(toEraYear(parsed!.year)).toEqual({ era: 'BCE', yearOfEra: 123 });
  });

  it('shows calendar style and reference previews at the top', () => {
    wrap(
      <SceneTemporalDialog
        isOpen
        value={'2026-05-10T11:45:12+00:00[UTC][u-ca=japanese]'}
        previousValue={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(screen.getByText(/Selected Time Preview/i)).toBeTruthy();
    expect(screen.getByText(/Gregorian \/ International/i)).toBeTruthy();
    expect(screen.getByText(/ISO \/ Temporal/i)).toBeTruthy();
  });

  it('keeps reference previews available for valid current value even if builder date is temporarily invalid', () => {
    wrap(
      <SceneTemporalDialog
        isOpen
        value={'2026-05-10T11:45:12+00:00[UTC][u-ca=islamic]'}
        previousValue={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/Interpret Builder As/i), {
      target: { value: 'calendarStyle' },
    });

    fireEvent.change(screen.getByLabelText(/Day/i), { target: { value: '31' } });

    const unavailableTexts = screen.queryAllByText(
      /Not available until the date is valid\./i
    );
    expect(unavailableTexts.length).toBe(0);
  });

  it('applies current moment when calendar style is islamic', async () => {
    const onApply = vi.fn();

    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={onApply}
      />
    );

    fireEvent.change(screen.getByLabelText(/Calendar Style/i), {
      target: { value: 'islamic' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Use Current Moment/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Scene Time/i }));
    });

    expect(onApply).toHaveBeenCalledOnce();
    const appliedValue = onApply.mock.calls[0][0] as string;
    const parsed = parseZonedDateTime(appliedValue);
    expect(parsed).toBeTruthy();
    expect(parsed?.calendarId.startsWith('islamic')).toBe(true);
  });

  it('validates malformed advanced Temporal strings', async () => {
    wrap(
      <SceneTemporalDialog
        isOpen
        value={null}
        previousValue={null}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Advanced Temporal String/i }));
    fireEvent.change(screen.getByLabelText(/Advanced Temporal String/i), {
      target: { value: 'not-a-temporal-value' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply Advanced Time/i }));
    });

    expect(screen.getByText(/invalid/i)).toBeTruthy();
  });
});
