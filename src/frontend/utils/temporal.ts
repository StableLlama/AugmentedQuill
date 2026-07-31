// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Temporal helpers with a Safari-safe fallback to @js-temporal/polyfill.
 */

import { Temporal as PolyfillTemporal } from '@js-temporal/polyfill';

export const TemporalApi: typeof PolyfillTemporal =
  (globalThis as { Temporal?: typeof PolyfillTemporal }).Temporal ?? PolyfillTemporal;

if (!(globalThis as { Temporal?: typeof PolyfillTemporal }).Temporal) {
  (globalThis as { Temporal?: typeof PolyfillTemporal }).Temporal = PolyfillTemporal;
}

type ZonedDateTimeValue = ReturnType<(typeof TemporalApi.ZonedDateTime)['from']>;
type TemporalDurationLike = Parameters<ZonedDateTimeValue['add']>[0];

export type StoryEra = 'BCE' | 'CE';

export interface StoryDateParts {
  era: StoryEra;
  yearOfEra: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZone: string;
  calendar: string;
}

interface StoryDateBuildOptions {
  inputCalendar?: string;
  outputCalendar?: string;
}

const CALENDAR_ALIASES: Readonly<Record<string, string[]>> = {
  islamic: ['islamic-umalqura', 'islamic-civil', 'islamic-tbla'],
};

const MONTH_NAMES_EN: ReadonlyArray<string> = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_NAMES_BY_LANGUAGE: Readonly<Record<string, ReadonlyArray<string>>> = {
  en: MONTH_NAMES_EN,
  de: [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ],
  fr: [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
};

const CALENDAR_LOCALES: Readonly<Record<string, string[]>> = {
  gregory: ['en-GB-u-ca-gregory'],
  iso8601: ['en-GB-u-ca-gregory'],
  japanese: ['ja-JP-u-ca-japanese', 'en-u-ca-japanese'],
  buddhist: ['th-TH-u-ca-buddhist', 'en-u-ca-buddhist'],
  roc: ['zh-TW-u-ca-roc', 'en-u-ca-roc'],
  persian: ['fa-IR-u-ca-persian', 'en-u-ca-persian'],
  islamic: ['ar-SA-u-ca-islamic', 'en-u-ca-islamic'],
  hebrew: ['he-IL-u-ca-hebrew', 'en-u-ca-hebrew'],
  chinese: ['zh-CN-u-ca-chinese', 'en-u-ca-chinese'],
  indian: ['hi-IN-u-ca-indian', 'en-u-ca-indian'],
};

const normalizeCalendarId = (calendarId: string): string => {
  if (calendarId.startsWith('islamic')) return 'islamic';
  return calendarId;
};

const calendarCandidates = (calendarId: string): string[] => {
  const normalized = normalizeCalendarId(calendarId);
  const aliases = CALENDAR_ALIASES[normalized] ?? [];
  return Array.from(new Set([calendarId, normalized, ...aliases]));
};

const withCalendarSafe = (
  value: ZonedDateTimeValue,
  calendarId: string
): ZonedDateTimeValue | null => {
  for (const candidate of calendarCandidates(calendarId)) {
    try {
      return value.withCalendar(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

const FALLBACK_TIME_ZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'America/St_Johns',
  'America/Halifax',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
];

const DATE_ONLY_RE = /^[+-]?\d{4,}-\d{2}-\d{2}$/;
const DATE_TIME_MINUTE_RE =
  /^(?<prefix>[+-]?\d{4,}-\d{2}-\d{2}[T ]\d{2}:\d{2})(?<suffix>Z|[+-]\d{2}:?\d{2})?$/;
const OFFSET_NO_COLON_RE = /([+-]\d{2})(\d{2})$/;

const normalizeLooseSceneTime = (rawValue: string): string => {
  let value = rawValue.trim();
  if (!value) return '';

  if (DATE_ONLY_RE.test(value)) {
    return `${value}T12:00:00Z`;
  }

  value = value.replace(' ', 'T');
  const minuteMatch = DATE_TIME_MINUTE_RE.exec(value);
  if (minuteMatch?.groups) {
    const prefix = minuteMatch.groups.prefix;
    const suffix = minuteMatch.groups.suffix ?? 'Z';
    value = `${prefix}:00${suffix}`;
  }

  if (value.endsWith('z')) {
    value = `${value.slice(0, -1)}Z`;
  }

  if (OFFSET_NO_COLON_RE.test(value)) {
    value = value.replace(OFFSET_NO_COLON_RE, '$1:$2');
  }

  const valueWithoutBrackets = value.replace(/\[[^\]]+\]/g, '');
  const hasOffsetOrZulu = /(Z|[+-]\d{2}:\d{2})$/.test(valueWithoutBrackets);
  if (valueWithoutBrackets.includes('T') && !hasOffsetOrZulu) {
    value = `${value}Z`;
  }

  return value;
};

const parseLooseAsZonedDateTime = (value: string): ZonedDateTimeValue | null => {
  const normalized = normalizeLooseSceneTime(value);
  if (!normalized) return null;
  const isoInstantLike = normalized.replace(/\[[^\]]+\]/g, '');

  try {
    const instant = TemporalApi.Instant.from(isoInstantLike);
    return instant.toZonedDateTimeISO('UTC');
  } catch {
    return null;
  }
};

export const parseZonedDateTime = (
  value: string | null | undefined
): ZonedDateTimeValue | null => {
  if (!value) return null;
  try {
    return TemporalApi.ZonedDateTime.from(value);
  } catch {
    return parseLooseAsZonedDateTime(value);
  }
};

export const toIsoYear = (era: StoryEra, yearOfEra: number): number =>
  era === 'BCE' ? 1 - yearOfEra : yearOfEra;

export const toEraYear = (isoYear: number): { era: StoryEra; yearOfEra: number } =>
  isoYear <= 0
    ? { era: 'BCE', yearOfEra: 1 - isoYear }
    : { era: 'CE', yearOfEra: isoYear };

const formatFallback = (value: ZonedDateTimeValue, calendarLabel?: string): string => {
  const padded = (num: number): string => String(num).padStart(2, '0');
  const eraYear = toEraYear(value.year);
  return `${eraYear.yearOfEra} ${eraYear.era} ${padded(value.month)}-${padded(value.day)} ${padded(value.hour)}:${padded(value.minute)}:${padded(value.second)} (${value.timeZoneId}, ${calendarLabel ?? value.calendarId})`;
};

const monthNamesForLocale = (locale?: string): ReadonlyArray<string> => {
  const language = (locale ?? 'en').split('-')[0].toLowerCase();
  return MONTH_NAMES_BY_LANGUAGE[language] ?? MONTH_NAMES_EN;
};

const formatNarrative = (
  value: ZonedDateTimeValue,
  calendarId: string,
  locale?: string
): string => {
  const normalized = normalizeCalendarId(calendarId);
  const padded = (num: number): string => String(num).padStart(2, '0');
  if (normalized === 'gregory' || normalized === 'iso8601') {
    const eraYear = toEraYear(value.year);
    const monthName =
      monthNamesForLocale(locale)[value.month - 1] ?? String(value.month);
    return `${value.day} ${monthName} ${eraYear.yearOfEra} ${eraYear.era}, ${padded(value.hour)}:${padded(value.minute)}:${padded(value.second)}`;
  }
  return `${padded(value.day)}-${padded(value.month)}-${value.year}, ${padded(value.hour)}:${padded(value.minute)}:${padded(value.second)} (${normalized})`;
};

const formatWithLocale = (
  value: ZonedDateTimeValue,
  calendarId: string,
  locale?: string
): string => {
  const preferredLocales = locale ? [`${locale}-u-ca-${calendarId}`, locale] : [];
  const locales = Array.from(
    new Set([
      ...preferredLocales,
      ...(CALENDAR_LOCALES[calendarId] ?? [`en-u-ca-${calendarId}`]),
    ])
  );
  for (const locale of locales) {
    try {
      return value.toLocaleString(locale, {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
    } catch {
      // Try the next locale candidate.
    }
  }
  return '';
};

export const toDisplayString = (
  value: string | null | undefined,
  locale?: string
): string => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return '';
  const inCalendar = withCalendarSafe(parsed, parsed.calendarId) ?? parsed;
  return formatNarrative(inCalendar, inCalendar.calendarId, locale);
};

export const toDisplayStringInCalendar = (
  value: string | null | undefined,
  calendar: string,
  locale?: string
): string => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return '';
  const inCalendar = withCalendarSafe(parsed, calendar || parsed.calendarId);
  if (!inCalendar) {
    // Calendar conversion failed: fall back to Gregorian narrative rather than a technical dump.
    const asGregory = withCalendarSafe(parsed, 'gregory') ?? parsed;
    return formatNarrative(asGregory, 'gregory', locale);
  }
  return formatNarrative(inCalendar, inCalendar.calendarId, locale);
};

export const toInternationalDisplayString = (
  value: string | null | undefined,
  locale?: string
): string => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return '';
  // Convert to Gregorian so BCE/CE is always shown correctly regardless of stored calendar.
  const asGregory = withCalendarSafe(parsed, 'gregory') ?? parsed;
  const narrative = formatNarrative(asGregory, 'gregory', locale);
  // Append the IANA timezone name (not the offset) so writers see "Europe/Berlin" not "GMT+0:53:28".
  return `${narrative} (${parsed.timeZoneId})`;
};

export const toIsoReferenceString = (value: string | null | undefined): string => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return '';
  try {
    return parsed.withCalendar('iso8601').toString();
  } catch {
    return parsed.toString();
  }
};

export const shiftTemporal = (
  value: string,
  duration: TemporalDurationLike
): string | null => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return null;
  try {
    return parsed.add(duration).toString();
  } catch {
    return null;
  }
};

export const nowTemporal = (timeZone: string, calendar: string): string => {
  let now = TemporalApi.Now.zonedDateTimeISO(timeZone || 'UTC');
  if (calendar && calendar !== 'iso8601') {
    const converted = withCalendarSafe(now, calendar);
    if (converted) {
      now = converted;
    }
  }
  return now.toString();
};

export const getSupportedTimeZones = (): string[] => {
  const dedupe = (values: string[]): string[] => Array.from(new Set(values));
  try {
    const intl = Intl as typeof Intl & {
      supportedValuesOf?: (kind: 'timeZone') => string[];
    };
    if (typeof intl.supportedValuesOf === 'function') {
      return dedupe([...FALLBACK_TIME_ZONES, ...intl.supportedValuesOf('timeZone')]);
    }
  } catch {
    // ignored
  }
  return [...FALLBACK_TIME_ZONES];
};

export const toStoryDateParts = (value: string | null | undefined): StoryDateParts => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) {
    return {
      era: 'CE',
      yearOfEra: 2026,
      month: 1,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
      timeZone: 'UTC',
      calendar: 'gregory',
    };
  }
  const eraYear = toEraYear(parsed.year);
  return {
    era: eraYear.era,
    yearOfEra: eraYear.yearOfEra,
    month: parsed.month,
    day: parsed.day,
    hour: parsed.hour,
    minute: parsed.minute,
    second: parsed.second,
    timeZone: parsed.timeZoneId,
    calendar: normalizeCalendarId(parsed.calendarId),
  };
};

export const toStoryDatePartsInCalendar = (
  value: string | null | undefined,
  calendar: string
): StoryDateParts => {
  const parsed = parseZonedDateTime(value);
  if (!parsed) return toStoryDateParts(value);

  const targetCalendar = calendar || 'gregory';
  const inCalendar = withCalendarSafe(parsed, targetCalendar);
  if (!inCalendar) {
    return toStoryDateParts(value);
  }
  try {
    const eraYear = toEraYear(inCalendar.year);
    return {
      era: eraYear.era,
      yearOfEra: eraYear.yearOfEra,
      month: inCalendar.month,
      day: inCalendar.day,
      hour: inCalendar.hour,
      minute: inCalendar.minute,
      second: inCalendar.second,
      timeZone: inCalendar.timeZoneId,
      calendar: normalizeCalendarId(parsed.calendarId),
    };
  } catch {
    return toStoryDateParts(value);
  }
};

export const fromStoryDatePartsWithOptions = (
  parts: StoryDateParts,
  options?: StoryDateBuildOptions
): string | null => {
  const inputCalendar = options?.inputCalendar || parts.calendar || 'gregory';
  const outputCalendar = options?.outputCalendar || parts.calendar || 'gregory';
  const isInt = (value: number): boolean => Number.isInteger(value);
  if (
    !isInt(parts.yearOfEra) ||
    parts.yearOfEra < 1 ||
    !isInt(parts.month) ||
    parts.month < 1 ||
    parts.month > 12 ||
    !isInt(parts.day) ||
    parts.day < 1 ||
    parts.day > 31 ||
    !isInt(parts.hour) ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    !isInt(parts.minute) ||
    parts.minute < 0 ||
    parts.minute > 59 ||
    !isInt(parts.second) ||
    parts.second < 0 ||
    parts.second > 59
  ) {
    return null;
  }
  try {
    const plainDate = TemporalApi.PlainDate.from({
      year: toIsoYear(parts.era, parts.yearOfEra),
      month: parts.month,
      day: parts.day,
      calendar: inputCalendar,
    });
    const plainDateTime = plainDate.toPlainDateTime({
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    });
    const zoned = plainDateTime.toZonedDateTime(parts.timeZone || 'UTC');
    if (outputCalendar && outputCalendar !== zoned.calendarId) {
      const converted = withCalendarSafe(zoned, outputCalendar);
      if (!converted) {
        return null;
      }
      return converted.toString();
    }
    return zoned.toString();
  } catch {
    return null;
  }
};

export const fromStoryDateParts = (parts: StoryDateParts): string | null => {
  return fromStoryDatePartsWithOptions(parts, {
    inputCalendar: parts.calendar,
    outputCalendar: parts.calendar,
  });
};
