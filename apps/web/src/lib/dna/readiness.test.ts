// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { joinReadiness } from '@holons/core/holons';
import { readinessBadge } from './readiness';

const CURRENT = 'c'.repeat(64);
const OLD = 'd'.repeat(64);

describe('readiness badge', () => {
  it('says what core says about a request against the DNA now', () => {
    expect(readinessBadge(joinReadiness({ dna: CURRENT }, CURRENT))).toEqual({ key: 'ready.acknowledged', tone: 'ok' });
    expect(readinessBadge(joinReadiness({ dna: OLD }, CURRENT))).toEqual({ key: 'ready.outdated', tone: 'warn' });
    expect(readinessBadge(joinReadiness({}, CURRENT))).toEqual({ key: 'ready.missing', tone: 'bad' });
  });

  it('shows nothing when the holon asks no agreement, and flags a DNA nobody could read', () => {
    expect(readinessBadge(joinReadiness({}, null))).toBeNull();
    expect(readinessBadge(joinReadiness({}, undefined))).toEqual({ key: 'ready.unknown', tone: 'muted' });
  });
});
