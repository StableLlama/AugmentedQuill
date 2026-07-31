// Copyright (C) 2026 StableLlama
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Tests for Temporal utility helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  fromStoryDateParts,
  fromStoryDatePartsWithOptions,
  getSupportedTimeZones,
  nowTemporal,
  parseZonedDateTime,
  TemporalApi,
  toDisplayString,
  toDisplayStringInCalendar,
  toEraYear,
  toInternationalDisplayString,
  toIsoReferenceString,
  toStoryDateParts,
  toStoryDatePartsInCalendar,
} from './temporal';

describe('temporal utils', () => {
  it('returns empty display for null or invalid values', () => {
    expect(toDisplayString(null)).toBe('');
    expect(toDisplayString('not-a-temporal-string')).toBe('');
    expect(toInternationalDisplayString(null)).toBe('');
    expect(toInternationalDisplayString('not-a-temporal-string')).toBe('');
  });

  it('parses date-only scene times by assuming noon UTC', () => {
    const parsed = parseZonedDateTime('1985-11-05');
    expect(parsed).toBeTruthy();
    expect(parsed?.timeZoneId).toBe('UTC');
    expect(parsed?.hour).toBe(12);
    expect(parsed?.minute).toBe(0);
    expect(parsed?.second).toBe(0);
  });

  it('parses datetime scene times missing seconds and timezone', () => {
    const parsed = parseZonedDateTime('1985-11-05T20:00');
    expect(parsed).toBeTruthy();
    expect(parsed?.timeZoneId).toBe('UTC');
    expect(parsed?.hour).toBe(20);
    expect(parsed?.minute).toBe(0);
    expect(parsed?.second).toBe(0);
  });

  it('renders display strings for loose ISO-like values stored in story data', () => {
    expect(toDisplayString('1985-11-05')).not.toBe('');
    expect(toDisplayString('1985-11-05T20:00')).not.toBe('');
    expect(toInternationalDisplayString('1985-11-05T20:00')).toContain('UTC');
  });

  it('uses selected calendar style for primary display', () => {
    const japaneseValue = fromStoryDateParts({
      era: 'CE',
      yearOfEra: 2026,
      month: 5,
      day: 10,
      hour: 11,
      minute: 45,
      second: 12,
      timeZone: 'UTC',
      calendar: 'japanese',
    });
    expect(japaneseValue).toBeTruthy();
    const display = toDisplayString(japaneseValue);
    expect(display).not.toBe('');
  });

  it('can format the same value in an explicit calendar for preview', () => {
    const value = '2026-05-10T11:45:12+00:00[UTC][u-ca=japanese]';
    expect(toDisplayStringInCalendar(value, 'japanese')).not.toBe('');
    expect(toDisplayStringInCalendar(value, 'gregory')).not.toBe('');
  });

  it('supports islamic calendar conversion and display', () => {
    const value = fromStoryDatePartsWithOptions(
      {
        era: 'CE',
        yearOfEra: 2026,
        month: 5,
        day: 10,
        hour: 11,
        minute: 45,
        second: 12,
        timeZone: 'UTC',
        calendar: 'islamic',
      },
      {
        inputCalendar: 'gregory',
        outputCalendar: 'islamic',
      }
    );

    expect(value).toBeTruthy();
    expect(toDisplayStringInCalendar(value, 'islamic')).not.toBe('');
  });

  it('always returns a clean narrative display regardless of locale formatting availability', () => {
    const temporalValue = '0044-03-15T12:00:00+00:00[UTC][u-ca=gregory]';
    const display = toDisplayString(temporalValue);
    expect(display).toContain('44 CE');
    expect(display).toContain('March');
    expect(display).toContain('12:00:00');
    // Must not contain timezone offsets or raw zone identifiers in the output
    expect(display).not.toContain('GMT');
    expect(display).not.toContain('+');
  });

  it('converts BCE years correctly through story date parts', () => {
    const value = fromStoryDateParts({
      era: 'BCE',
      yearOfEra: 44,
      month: 3,
      day: 15,
      hour: 12,
      minute: 0,
      second: 30,
      timeZone: 'Europe/Rome',
      calendar: 'gregory',
    });

    expect(value).toBeTruthy();
    const parts = toStoryDateParts(value);
    expect(parts.era).toBe('BCE');
    expect(parts.yearOfEra).toBe(44);
  });

  it('returns null for invalid story date parts', () => {
    const value = fromStoryDateParts({
      era: 'CE',
      yearOfEra: 2026,
      month: 12,
      day: 1,
      hour: 99,
      minute: 0,
      second: 0,
      timeZone: 'UTC',
      calendar: 'gregory',
    });
    expect(value).toBeNull();
  });

  it('provides safe defaults for invalid source values', () => {
    const parts = toStoryDateParts('invalid-temporal-value');
    expect(parts.era).toBe('CE');
    expect(parts.yearOfEra).toBe(2026);
    expect(parts.timeZone).toBe('UTC');
  });

  it('exposes a timezone list with UTC and regional zones', () => {
    const zones = getSupportedTimeZones();
    expect(zones).toContain('UTC');
    expect(zones.some((zone: string): boolean => zone !== 'UTC')).toBe(true);
  });

  it('maps proleptic years to era/year-of-era correctly', () => {
    expect(toEraYear(2026)).toEqual({ era: 'CE', yearOfEra: 2026 });
    expect(toEraYear(0)).toEqual({ era: 'BCE', yearOfEra: 1 });
    expect(toEraYear(-43)).toEqual({ era: 'BCE', yearOfEra: 44 });
  });

  it('provides international comparison format from same temporal value', () => {
    const value = fromStoryDateParts({
      era: 'BCE',
      yearOfEra: 44,
      month: 3,
      day: 15,
      hour: 12,
      minute: 0,
      second: 45,
      timeZone: 'UTC',
      calendar: 'japanese',
    });
    expect(value).toBeTruthy();
    const display = toInternationalDisplayString(value);
    expect(display).toContain('UTC');
  });

  it('provides ISO reference output from the same temporal value', () => {
    const value = '2026-05-10T11:45:12+00:00[UTC][u-ca=japanese]';
    const iso = toIsoReferenceString(value);
    expect(iso).toContain('2026-05-10T11:45:12');
    expect(iso).toContain('[UTC]');
  });

  it('supports Gregorian input with non-Gregorian output calendar', () => {
    const value = fromStoryDatePartsWithOptions(
      {
        era: 'CE',
        yearOfEra: 2026,
        month: 5,
        day: 10,
        hour: 11,
        minute: 45,
        second: 22,
        timeZone: 'UTC',
        calendar: 'japanese',
      },
      {
        inputCalendar: 'gregory',
        outputCalendar: 'japanese',
      }
    );

    expect(value).toBeTruthy();
    const parsed = TemporalApi.ZonedDateTime.from(value!);
    expect(parsed.calendarId).toBe('japanese');

    const asGregory = parsed.withCalendar('gregory');
    expect(asGregory.year).toBe(2026);
    expect(asGregory.month).toBe(5);
    expect(asGregory.day).toBe(10);
    expect(asGregory.second).toBe(22);
  });

  it('can extract builder parts in a requested calendar', () => {
    const source = '2026-05-10T11:45:00+00:00[UTC][u-ca=japanese]';
    const gregoryParts = toStoryDatePartsInCalendar(source, 'gregory');
    expect(gregoryParts.era).toBe('CE');
    expect(gregoryParts.yearOfEra).toBe(2026);
    expect(gregoryParts.month).toBe(5);
    expect(gregoryParts.day).toBe(10);
    expect(gregoryParts.second).toBe(0);
    expect(gregoryParts.calendar).toBe('japanese');
  });

  it('formats Gregorian calendar display with provided locale', () => {
    const value = '2026-03-15T12:00:00+00:00[UTC][u-ca=gregory]';
    const french = toDisplayStringInCalendar(value, 'gregory', 'fr-FR').toLowerCase();
    expect(french).toContain('mars');
    expect(french).not.toContain('gmt');
    expect(french).not.toContain('+');
  });

  it('formats Islamic calendar display with provided locale without empty output', () => {
    const value = '2026-05-10T11:45:12+00:00[UTC][u-ca=islamic]';
    const display = toDisplayStringInCalendar(value, 'islamic', 'ar-SA');
    expect(display).not.toBe('');
    expect(display).not.toContain('GMT');
  });

  it('shows BCE in international display and timezone name not offset', () => {
    const value = fromStoryDateParts({
      era: 'BCE',
      yearOfEra: 44,
      month: 3,
      day: 15,
      hour: 12,
      minute: 0,
      second: 0,
      timeZone: 'Europe/Berlin',
      calendar: 'gregory',
    });
    expect(value).toBeTruthy();
    const intl = toInternationalDisplayString(value);
    expect(intl).toContain('BCE');
    expect(intl).toContain('Europe/Berlin');
    // Must not show raw offset like GMT+0:53:28
    expect(intl).not.toMatch(/GMT[+-]/);
  });

  it('creates current moment values for islamic calendar safely', () => {
    const value = nowTemporal('UTC', 'islamic');
    const parsed = parseZonedDateTime(value);
    expect(parsed).toBeTruthy();
    expect(parsed?.calendarId.startsWith('islamic')).toBe(true);
  });
});
