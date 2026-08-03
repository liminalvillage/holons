// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { getDefaultHolonSettings, parseHolonSettings } from './flow-settings.js';

describe('holon settings hex default', () => {
  it('defaults hex to empty — never the legacy CSS color', () => {
    expect(getDefaultHolonSettings('h1').hex).toBe('');
    expect(parseHolonSettings({}).hex).toBe('');
  });

  it('keeps a persisted hex address', () => {
    expect(parseHolonSettings({ hex: '8928308280fffff' }).hex).toBe('8928308280fffff');
  });
});
