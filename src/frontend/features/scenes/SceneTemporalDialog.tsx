// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Dialog for choosing scene chronology with a writer-friendly Temporal workflow.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useThemeClasses } from '../layout/ThemeContext';
import { useFocusTrap } from '../layout/useFocusTrap';
import { Button } from '../../components/ui/Button';
import { useStoryLanguage } from '../../stores/storyStore';
import {
  fromStoryDatePartsWithOptions,
  getSupportedTimeZones,
  nowTemporal,
  shiftTemporal,
  StoryDateParts,
  TemporalApi,
  toDisplayString,
  toDisplayStringInCalendar,
  toEraYear,
  toInternationalDisplayString,
  toIsoReferenceString,
  toIsoYear,
  toStoryDateParts,
  toStoryDatePartsInCalendar,
} from '../../utils/temporal';

interface SceneTemporalDialogProps {
  isOpen: boolean;
  value: string | null;
  previousValue: string | null;
  onClose: () => void;
  onApply: (value: string | null) => void;
}

type CalendarOption = {
  id: string;
  labelKey: string;
  descriptionKey: string;
};

type FeaturedTimeZone = { value: string; labelKey: string };

const CALENDAR_OPTIONS: ReadonlyArray<CalendarOption> = [
  {
    id: 'gregory',
    labelKey: 'Western (Gregorian)',
    descriptionKey: 'Most modern historical and contemporary fiction.',
  },
  {
    id: 'iso8601',
    labelKey: 'ISO / International',
    descriptionKey: 'Technical standard date style.',
  },
  {
    id: 'japanese',
    labelKey: 'Japanese Imperial',
    descriptionKey: 'Era-based Japanese calendar system.',
  },
  {
    id: 'buddhist',
    labelKey: 'Thai Buddhist',
    descriptionKey: 'Common in Thai and Buddhist historical contexts.',
  },
  {
    id: 'roc',
    labelKey: 'Minguo (Taiwan)',
    descriptionKey: 'Republic of China calendar system.',
  },
  {
    id: 'persian',
    labelKey: 'Persian',
    descriptionKey: 'Solar Hijri calendar tradition.',
  },
  {
    id: 'islamic',
    labelKey: 'Islamic',
    descriptionKey: 'Lunar Hijri calendar tradition.',
  },
  {
    id: 'hebrew',
    labelKey: 'Hebrew',
    descriptionKey: 'Traditional Hebrew lunisolar calendar.',
  },
  {
    id: 'chinese',
    labelKey: 'Chinese',
    descriptionKey: 'Traditional lunisolar Chinese calendar.',
  },
  {
    id: 'indian',
    labelKey: 'Indian National',
    descriptionKey: 'Saka calendar system.',
  },
];

const FEATURED_TIME_ZONES: ReadonlyArray<FeaturedTimeZone> = [
  { value: 'UTC', labelKey: 'Global reference (UTC)' },
  { value: 'Europe/London', labelKey: 'London' },
  { value: 'Europe/Paris', labelKey: 'Paris' },
  { value: 'Europe/Berlin', labelKey: 'Berlin' },
  { value: 'Europe/Rome', labelKey: 'Rome' },
  { value: 'Europe/Athens', labelKey: 'Athens' },
  { value: 'Africa/Cairo', labelKey: 'Cairo' },
  { value: 'Asia/Jerusalem', labelKey: 'Jerusalem' },
  { value: 'Asia/Dubai', labelKey: 'Dubai' },
  { value: 'Asia/Kolkata', labelKey: 'Delhi / Kolkata' },
  { value: 'Asia/Tokyo', labelKey: 'Tokyo' },
  { value: 'Australia/Sydney', labelKey: 'Sydney' },
  { value: 'America/New_York', labelKey: 'New York' },
  { value: 'America/Chicago', labelKey: 'Chicago' },
  { value: 'America/Los_Angeles', labelKey: 'Los Angeles' },
  { value: 'America/Sao_Paulo', labelKey: 'Sao Paulo' },
];

type DateInputBasis = 'gregory' | 'calendarStyle';

const getCalendarOption = (
  calendarId: string
): { id: string; labelKey: string; descriptionKey: string } | null =>
  CALENDAR_OPTIONS.find(
    (option: CalendarOption): boolean => option.id === calendarId
  ) ?? null;

const getBuilderCalendar = (sceneCalendar: string, basis: DateInputBasis): string =>
  basis === 'gregory' ? 'gregory' : sceneCalendar || 'gregory';

const toSignedYearInput = (parts: StoryDateParts): string =>
  String(toIsoYear(parts.era, parts.yearOfEra));

export const SceneTemporalDialog: React.FC<SceneTemporalDialogProps> = ({
  isOpen,
  value,
  previousValue,
  onClose,
  onApply,
}: SceneTemporalDialogProps) => {
  const { t, i18n } = useTranslation();
  const tc = useThemeClasses();
  const storyLanguage = useStoryLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useFocusTrap(isOpen, dialogRef, onClose);

  const [draft, setDraft] = useState<StoryDateParts>(toStoryDateParts(value));
  const [dateInputBasis, setDateInputBasis] = useState<DateInputBasis>('gregory');
  const [calendarYearInput, setCalendarYearInput] = useState('2026');
  const [timeZoneInput, setTimeZoneInput] = useState('UTC');
  const [advancedText, setAdvancedText] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportedZones = useMemo((): string[] => getSupportedTimeZones(), []);

  useEffect((): void => {
    if (!isOpen) return;
    const sceneDraft = toStoryDateParts(value);
    const nextDraft = toStoryDatePartsInCalendar(value, 'gregory');
    const draftWithSceneCalendar: StoryDateParts = {
      ...nextDraft,
      calendar: sceneDraft.calendar || nextDraft.calendar,
    };
    setDraft(draftWithSceneCalendar);
    setDateInputBasis('gregory');
    setCalendarYearInput(toSignedYearInput(draftWithSceneCalendar));
    setTimeZoneInput(draftWithSceneCalendar.timeZone);
    setAdvancedText(value ?? '');
    setAdvancedOpen(false);
    setError(null);
  }, [isOpen, value]);

  if (!isOpen) return null;

  const fieldClass = `w-full px-3 py-2 rounded-lg border ${tc.border} ${tc.input} ${tc.text} text-sm focus:outline-none focus:ring-2 focus:ring-brand-500`;
  const buttonTheme = tc.isLight ? 'light' : 'dark';

  const updateDraft = (update: Partial<StoryDateParts>): void => {
    setDraft((prev: StoryDateParts): StoryDateParts => ({ ...prev, ...update }));
  };

  const syncDraft = (nextDraft: StoryDateParts): void => {
    setDraft(nextDraft);
    setCalendarYearInput(toSignedYearInput(nextDraft));
  };

  const buildTemporalFromDraft = (
    currentDraft: StoryDateParts,
    basis: DateInputBasis
  ): string | null =>
    fromStoryDatePartsWithOptions(
      {
        ...currentDraft,
        timeZone: timeZoneInput.trim() || currentDraft.timeZone,
      },
      {
        inputCalendar: getBuilderCalendar(currentDraft.calendar, basis),
        outputCalendar: currentDraft.calendar,
      }
    );

  const applyQuickValue = (next: string): void => {
    const sceneDraft = toStoryDateParts(next);
    const nextDraft = toStoryDatePartsInCalendar(
      next,
      getBuilderCalendar(sceneDraft.calendar, dateInputBasis)
    );
    syncDraft({ ...nextDraft, calendar: sceneDraft.calendar });
    setTimeZoneInput(nextDraft.timeZone);
    setAdvancedText(next);
    setError(null);
  };

  const applyFromBuilder = (): void => {
    const next = buildTemporalFromDraft(draft, dateInputBasis);
    if (!next) {
      setError(t('Please check the date, time, calendar, and region values.'));
      return;
    }
    onApply(next);
    onClose();
  };

  const applyFromAdvanced = (): void => {
    try {
      const parsed = TemporalApi.ZonedDateTime.from(advancedText.trim());
      onApply(parsed.toString());
      onClose();
    } catch {
      setError(t('The advanced time format is invalid.'));
    }
  };

  const calendarOption = getCalendarOption(draft.calendar);
  const previewValue = buildTemporalFromDraft(draft, dateInputBasis);
  const previewReferenceValue = previewValue ?? value;
  const displayLocale = storyLanguage || i18n.resolvedLanguage || i18n.language;
  const previewDisplay = toDisplayStringInCalendar(
    previewReferenceValue,
    draft.calendar,
    displayLocale
  );
  const previewInternationalDisplay =
    toInternationalDisplayString(previewReferenceValue);
  const previewIsoDisplay = toIsoReferenceString(previewReferenceValue);
  const currentDisplay = toDisplayStringInCalendar(
    value,
    draft.calendar,
    displayLocale
  );
  const previousDisplay = toDisplayString(previousValue, displayLocale);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-brand-gray-950/70 backdrop-blur-sm p-2 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div
        className={`w-full max-w-5xl h-[95vh] md:h-[88vh] rounded-xl border shadow-2xl flex flex-col overflow-hidden ${tc.bg} ${tc.border} ${tc.text}`}
      >
        <div
          className={`px-5 py-4 border-b ${tc.border} flex items-start justify-between gap-4 ${tc.bgAccent}`}
        >
          <div>
            <h3 id={titleId} className="text-lg font-semibold">
              {t('Scene Time')}
            </h3>
            <p id={descriptionId} className={`mt-1 text-sm ${tc.muted}`}>
              {t(
                'Choose the scene moment, how the builder should interpret your input, and how the scene should display that time.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close scene time dialog')}
            className={`rounded-md p-1 transition-colors ${
              tc.isLight
                ? 'text-brand-gray-500 hover:text-brand-gray-700 hover:bg-brand-gray-100'
                : 'text-brand-gray-500 hover:text-brand-gray-300 hover:bg-brand-gray-800'
            }`}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
          <section
            className={`rounded-xl border ${tc.border} ${tc.card} p-4 space-y-3`}
          >
            <div>
              <p className={`text-xs uppercase tracking-wide ${tc.muted}`}>
                {t('Selected Time Preview')}
              </p>
              <p className={`mt-1 text-xs ${tc.muted}`}>
                {t(
                  'Preview the same moment in the scene calendar and in a Gregorian/ISO reference format.'
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
              <div className={`rounded-lg border ${tc.border} ${tc.bg} p-3`}>
                <p className={`text-[11px] uppercase tracking-wide ${tc.muted}`}>
                  {t('Calendar Style')}
                </p>
                <p className={`mt-1 ${tc.text}`}>
                  {previewDisplay || currentDisplay || t('No scene time set.')}
                </p>
              </div>
              <div className={`rounded-lg border ${tc.border} ${tc.bg} p-3`}>
                <p className={`text-[11px] uppercase tracking-wide ${tc.muted}`}>
                  {t('Gregorian / International')}
                </p>
                <p className={`mt-1 ${tc.text}`}>
                  {previewInternationalDisplay ||
                    t('Not available until the date is valid.')}
                </p>
              </div>
              <div className={`rounded-lg border ${tc.border} ${tc.bg} p-3`}>
                <p className={`text-[11px] uppercase tracking-wide ${tc.muted}`}>
                  {t('ISO / Temporal')}
                </p>
                <p className={`mt-1 ${tc.text} break-all font-mono text-xs`}>
                  {previewIsoDisplay || t('Not available until the date is valid.')}
                </p>
              </div>
            </div>
          </section>

          <section className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              theme={buttonTheme}
              onClick={(): void =>
                applyQuickValue(
                  nowTemporal(timeZoneInput || draft.timeZone, draft.calendar)
                )
              }
            >
              {t('Use Current Moment')}
            </Button>
            {previousValue && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  theme={buttonTheme}
                  onClick={(): void => applyQuickValue(previousValue)}
                  title={previousDisplay}
                >
                  {t('Use Previous Scene Time')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  theme={buttonTheme}
                  onClick={(): void => {
                    const shifted = shiftTemporal(previousValue, { minutes: 15 });
                    if (shifted) applyQuickValue(shifted);
                  }}
                >
                  {t('Previous +15m')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  theme={buttonTheme}
                  onClick={(): void => {
                    const shifted = shiftTemporal(previousValue, { hours: 1 });
                    if (shifted) applyQuickValue(shifted);
                  }}
                >
                  {t('Previous +1h')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  theme={buttonTheme}
                  onClick={(): void => {
                    const shifted = shiftTemporal(previousValue, { days: 1 });
                    if (shifted) applyQuickValue(shifted);
                  }}
                >
                  {t('Previous +1d')}
                </Button>
              </>
            )}
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section
              className={`rounded-xl border ${tc.border} ${tc.card} p-4 space-y-4`}
            >
              <div>
                <h4 className="text-sm font-semibold">{t('Story Date Builder')}</h4>
                <p className={`mt-1 text-xs ${tc.muted}`}>
                  {t(
                    'Step 1: enter the date and time values you think in. Step 2: choose how the scene should represent that same moment.'
                  )}
                </p>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                >
                  {t('Interpret Builder As')}
                </label>
                <select
                  aria-label={t('Interpret Builder As')}
                  className={fieldClass}
                  value={dateInputBasis}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                    const nextBasis = e.target.value as DateInputBasis;
                    const built = buildTemporalFromDraft(draft, dateInputBasis);
                    const nextInputCalendar = getBuilderCalendar(
                      draft.calendar,
                      nextBasis
                    );
                    if (built) {
                      const rebuilt = toStoryDatePartsInCalendar(
                        built,
                        nextInputCalendar
                      );
                      syncDraft({ ...rebuilt, calendar: draft.calendar });
                    }
                    setDateInputBasis(nextBasis);
                  }}
                >
                  <option value="gregory">{t('Gregorian (default)')}</option>
                  <option value="calendarStyle">{t('Calendar Style')}</option>
                </select>
                <p className={`mt-1 text-xs ${tc.muted}`}>
                  {dateInputBasis === 'gregory'
                    ? t(
                        'Builder fields are interpreted as Gregorian date/time. Calendar Style still controls representation.'
                      )
                    : t(
                        'Builder fields are interpreted in the selected Calendar Style and stored with that representation.'
                      )}
                </p>
              </div>

              {dateInputBasis === 'gregory' ? (
                <div className="grid grid-cols-4 gap-2 items-end">
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Era')}
                    </label>
                    <select
                      aria-label={t('Era')}
                      className={fieldClass}
                      value={draft.era}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>): void =>
                        updateDraft({ era: e.target.value as StoryDateParts['era'] })
                      }
                    >
                      <option value="BCE">{t('BCE')}</option>
                      <option value="CE">{t('CE')}</option>
                    </select>
                  </div>
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Year')}
                    </label>
                    <input
                      type="number"
                      aria-label={t('Year')}
                      min={1}
                      value={draft.yearOfEra}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                        updateDraft({
                          yearOfEra: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Month')}
                    </label>
                    <input
                      type="number"
                      aria-label={t('Month')}
                      min={1}
                      max={12}
                      value={draft.month}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                        updateDraft({
                          month: Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Day')}
                    </label>
                    <input
                      type="number"
                      aria-label={t('Day')}
                      min={1}
                      max={31}
                      value={draft.day}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                        updateDraft({
                          day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Calendar Year')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={t('Calendar Year')}
                      value={calendarYearInput}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                        const nextValue = e.target.value.trim();
                        if (!/^[-]?[0-9]*$/.test(nextValue)) {
                          return;
                        }
                        setCalendarYearInput(nextValue);
                        if (nextValue === '' || nextValue === '-') {
                          return;
                        }
                        const nextYear = Number(nextValue);
                        if (!Number.isInteger(nextYear) || nextYear === 0) {
                          return;
                        }
                        const mapped = toEraYear(nextYear);
                        updateDraft({ era: mapped.era, yearOfEra: mapped.yearOfEra });
                      }}
                      onBlur={(): void => {
                        const trimmed = calendarYearInput.trim();
                        if (
                          trimmed === '' ||
                          trimmed === '-' ||
                          Number(trimmed) === 0
                        ) {
                          setCalendarYearInput(toSignedYearInput(draft));
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Month')}
                    </label>
                    <input
                      type="number"
                      aria-label={t('Month')}
                      min={1}
                      max={12}
                      value={draft.month}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                        updateDraft({
                          month: Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label
                      className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                    >
                      {t('Day')}
                    </label>
                    <input
                      type="number"
                      aria-label={t('Day')}
                      min={1}
                      max={31}
                      value={draft.day}
                      className={fieldClass}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                        updateDraft({
                          day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {dateInputBasis === 'calendarStyle' && (
                <p className={`text-xs ${tc.muted}`}>
                  {t(
                    'Use signed year numbering. Example: -122 means 123 BCE. There is no year 0.'
                  )}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label
                    className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                  >
                    {t('Hour')}
                  </label>
                  <input
                    type="number"
                    aria-label={t('Hour')}
                    min={0}
                    max={23}
                    value={draft.hour}
                    className={fieldClass}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                      updateDraft({
                        hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
                <div>
                  <label
                    className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                  >
                    {t('Minute')}
                  </label>
                  <input
                    type="number"
                    aria-label={t('Minute')}
                    min={0}
                    max={59}
                    value={draft.minute}
                    className={fieldClass}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                      updateDraft({
                        minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
                <div>
                  <label
                    className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                  >
                    {t('Second')}
                  </label>
                  <input
                    type="number"
                    aria-label={t('Second')}
                    min={0}
                    max={59}
                    value={draft.second}
                    className={fieldClass}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>): void =>
                      updateDraft({
                        second: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section
              className={`rounded-xl border ${tc.border} ${tc.card} p-4 space-y-4`}
            >
              <div>
                <h4 className="text-sm font-semibold">{t('World Context')}</h4>
                <p className={`mt-1 text-xs ${tc.muted}`}>
                  {t(
                    'Calendar Style controls how this scene time is represented and displayed.'
                  )}
                </p>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                >
                  {t('Common Regions')}
                </label>
                <select
                  aria-label={t('Common Regions')}
                  className={fieldClass}
                  value={
                    FEATURED_TIME_ZONES.some(
                      (zone: FeaturedTimeZone): boolean => zone.value === timeZoneInput
                    )
                      ? timeZoneInput
                      : ''
                  }
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                    if (!e.target.value) return;
                    setTimeZoneInput(e.target.value);
                    updateDraft({ timeZone: e.target.value });
                  }}
                >
                  <option value="">{t('Select a city/region')}</option>
                  {FEATURED_TIME_ZONES.map((zone: FeaturedTimeZone) => (
                    <option key={zone.value} value={zone.value}>
                      {t(zone.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                >
                  {t('Exact Time Zone')}
                </label>
                <input
                  aria-label={t('Exact Time Zone')}
                  list="scene-temporal-timezones"
                  value={timeZoneInput}
                  className={fieldClass}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                    const next = e.target.value;
                    setTimeZoneInput(next);
                    updateDraft({ timeZone: next });
                  }}
                />
                <datalist id="scene-temporal-timezones">
                  {supportedZones.map((zone: string) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                <p className={`mt-1 text-xs ${tc.muted}`}>
                  {t(
                    'Use a city above, or type any valid region (example: Europe/Paris).'
                  )}
                </p>
              </div>

              <div>
                <label
                  className={`block text-xs font-semibold uppercase ${tc.muted} mb-1`}
                >
                  {t('Calendar Style')}
                </label>
                <select
                  aria-label={t('Calendar Style')}
                  className={fieldClass}
                  value={draft.calendar}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                    const nextCalendar = e.target.value;
                    if (dateInputBasis !== 'calendarStyle') {
                      updateDraft({ calendar: nextCalendar });
                      return;
                    }
                    const rebuilt = fromStoryDatePartsWithOptions(
                      {
                        ...draft,
                        timeZone: timeZoneInput.trim() || draft.timeZone,
                      },
                      {
                        inputCalendar: draft.calendar,
                        outputCalendar: nextCalendar,
                      }
                    );
                    if (!rebuilt) {
                      updateDraft({ calendar: nextCalendar });
                      return;
                    }
                    const nextParts = toStoryDatePartsInCalendar(rebuilt, nextCalendar);
                    syncDraft({ ...nextParts, calendar: nextCalendar });
                  }}
                >
                  {CALENDAR_OPTIONS.map((option: CalendarOption) => (
                    <option key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
                <p className={`mt-1 text-xs ${tc.muted}`}>
                  {t(calendarOption?.descriptionKey ?? 'Custom calendar system.')}
                </p>
              </div>
            </section>
          </div>

          <section className={`rounded-xl border ${tc.border} ${tc.card}`}>
            <button
              type="button"
              className={`w-full px-4 py-3 text-left text-sm font-medium ${tc.text}`}
              onClick={(): void => setAdvancedOpen((prev: boolean): boolean => !prev)}
              aria-expanded={advancedOpen}
            >
              {t('Advanced Temporal String')}
            </button>
            {advancedOpen && (
              <div className={`p-4 border-t ${tc.border} space-y-3`}>
                <p className={`text-xs ${tc.muted}`}>
                  {t(
                    'Paste a complete Temporal.ZonedDateTime value for expert workflows.'
                  )}
                </p>
                <textarea
                  aria-label={t('Advanced Temporal String')}
                  rows={4}
                  value={advancedText}
                  className={`w-full px-3 py-2 rounded-lg border ${tc.border} ${tc.input} ${tc.text} text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500`}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void =>
                    setAdvancedText(e.target.value)
                  }
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="primary"
                    theme={buttonTheme}
                    onClick={applyFromAdvanced}
                  >
                    {t('Apply Advanced Time')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>

        <div
          className={`px-4 md:px-5 py-4 border-t ${tc.border} flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-3 ${tc.bgAccent}`}
        >
          <div className="min-h-[1.25rem]">
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              theme={buttonTheme}
              onClick={(): void => {
                onApply(null);
                onClose();
              }}
            >
              {t('Clear Time')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              theme={buttonTheme}
              onClick={onClose}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              theme={buttonTheme}
              onClick={applyFromBuilder}
            >
              {t('Apply Scene Time')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
