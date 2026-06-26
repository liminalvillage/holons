// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import {
  localFieldsToStored,
  parseInstant,
  toLocalDateField,
  toLocalTimeField,
  toStoredInstant,
} from './index.js';

describe('datetime', () => {
  describe('parseInstant', () => {
    it('returns null for empty/invalid input', () => {
      expect(parseInstant(null)).toBeNull();
      expect(parseInstant(undefined)).toBeNull();
      expect(parseInstant('')).toBeNull();
      expect(parseInstant('   ')).toBeNull();
      expect(parseInstant('not a date')).toBeNull();
    });

    it('parses a UTC instant unambiguously regardless of runner timezone', () => {
      const d = parseInstant('2026-06-26T12:00:00.000Z');
      expect(d?.getTime()).toBe(Date.UTC(2026, 5, 26, 12, 0, 0));
    });

    it('parses an offset-qualified instant', () => {
      const d = parseInstant('2026-06-26T12:00:00+02:00');
      expect(d?.getTime()).toBe(Date.UTC(2026, 5, 26, 10, 0, 0));
    });

    it('interprets a bare datetime as LOCAL wall-clock (legacy data)', () => {
      const d = parseInstant('2026-06-26T12:00');
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(5);
      expect(d?.getDate()).toBe(26);
      expect(d?.getHours()).toBe(12);
      expect(d?.getMinutes()).toBe(0);
    });

    it('interprets a bare date as LOCAL midnight (not UTC midnight)', () => {
      const d = parseInstant('2026-06-26');
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(5);
      expect(d?.getDate()).toBe(26);
      expect(d?.getHours()).toBe(0);
    });

    it('accepts a space separator and ignores fractional seconds', () => {
      const d = parseInstant('2026-06-26 09:30:15.250');
      expect(d?.getHours()).toBe(9);
      expect(d?.getMinutes()).toBe(30);
      expect(d?.getSeconds()).toBe(15);
    });

    it('passes a Date through', () => {
      const now = new Date('2026-06-26T12:00:00.000Z');
      expect(parseInstant(now)).toBe(now);
      expect(parseInstant(new Date('nope'))).toBeNull();
    });
  });

  describe('toStoredInstant', () => {
    it('emits a UTC ISO string with a Z', () => {
      const iso = toStoredInstant(new Date(Date.UTC(2026, 5, 26, 12, 0, 0)));
      expect(iso).toBe('2026-06-26T12:00:00.000Z');
      expect(iso.endsWith('Z')).toBe(true);
    });
  });

  describe('localFieldsToStored', () => {
    it('returns null for a missing/invalid date', () => {
      expect(localFieldsToStored(null)).toBeNull();
      expect(localFieldsToStored('')).toBeNull();
      expect(localFieldsToStored('garbage')).toBeNull();
    });

    it('keeps a date-only value bare (all-day, no UTC conversion)', () => {
      expect(localFieldsToStored('2026-06-26')).toBe('2026-06-26');
      expect(localFieldsToStored('2026-06-26', '')).toBe('2026-06-26');
    });

    it('emits a timezone-qualified UTC instant when a time is given', () => {
      const stored = localFieldsToStored('2026-06-26', '12:00');
      expect(stored).not.toBeNull();
      expect(stored!.endsWith('Z')).toBe(true);
      // The Z-form must reparse to the SAME local wall-clock the user picked.
      expect(toLocalDateField(stored)).toBe('2026-06-26');
      expect(toLocalTimeField(stored)).toBe('12:00');
    });
  });

  describe('form-field round trip', () => {
    it('local fields → stored → local fields is stable across the edit edge', () => {
      const date = '2026-12-31';
      const time = '23:45';
      const stored = localFieldsToStored(date, time);
      expect(toLocalDateField(stored)).toBe(date);
      expect(toLocalTimeField(stored)).toBe(time);
    });

    it('blank fields read back as empty strings', () => {
      expect(toLocalDateField(undefined)).toBe('');
      expect(toLocalTimeField(undefined)).toBe('');
    });
  });
});
