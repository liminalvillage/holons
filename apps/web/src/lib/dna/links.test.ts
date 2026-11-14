// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { applyHref, dnaHref, editDnaHref, holonHref } from './links';

describe('dna links', () => {
  it('points the dashboard pages at the holon', () => {
    expect(dnaHref('-1003864542239')).toBe('/-1003864542239/dna');
    expect(applyHref('-1003864542239')).toBe('/-1003864542239/apply');
    expect(holonHref('a b')).toBe('/a%20b');
  });

  it('sends "Edit DNA" to the one editor, the kiosk', () => {
    expect(editDnaHref('-1003864542239')).toMatch(/^https?:\/\/[^/]+\/-1003864542239\/dna\?edit$/);
  });
});
