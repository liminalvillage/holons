// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { navigateOutcome, viewsFromContext } from './ui-tools.js';

describe('viewsFromContext', () => {
  it('parses the comma list a client advertises', () => {
    expect(viewsFromContext({ views: 'tasks,calendar, library' })).toEqual([
      'tasks',
      'calendar',
      'library',
    ]);
  });

  it('is null without a usable list', () => {
    expect(viewsFromContext(undefined)).toBeNull();
    expect(viewsFromContext('tasks')).toBeNull();
    expect(viewsFromContext({})).toBeNull();
    expect(viewsFromContext({ views: ' , ' })).toBeNull();
    expect(viewsFromContext({ views: 42 })).toBeNull();
  });
});

describe('navigateOutcome', () => {
  const views = ['tasks', 'calendar', 'library'];

  it('accepts an exact view id', () => {
    const r = navigateOutcome({ view: 'calendar' }, views);
    expect(r).toMatchObject({ ok: true, view: 'calendar' });
  });

  it('tolerates spoken variants: case and a trailing tab/view word', () => {
    expect(navigateOutcome({ view: 'Calendar' }, views)).toMatchObject({
      ok: true,
      view: 'calendar',
    });
    expect(navigateOutcome({ view: 'the library tab'.replace('the ', '') }, views)).toMatchObject({
      ok: true,
      view: 'library',
    });
    expect(navigateOutcome({ view: 'Tasks view' }, views)).toMatchObject({
      ok: true,
      view: 'tasks',
    });
  });

  it('rejects unknown views and lists the real ones', () => {
    const r = navigateOutcome({ view: 'settings' }, views);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('tasks, calendar, library');
  });

  it('forbids a retry when the user asked for no existing view', () => {
    const r = navigateOutcome({ view: 'settings' }, views, 'open the settings');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('do NOT call ui_navigate');
  });

  it('suggests the view the user actually said', () => {
    const r = navigateOutcome({ view: 'agenda' }, views, 'show the calendar please');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('retry with exactly that id');
    expect(r.message).toContain('"calendar"');
  });

  it('rejects a missing view', () => {
    expect(navigateOutcome({}, views).ok).toBe(false);
    expect(navigateOutcome({ view: '  ' }, views).ok).toBe(false);
  });

  it('forwards as-is when the client advertised no list', () => {
    expect(navigateOutcome({ view: 'Roles tab' }, null)).toMatchObject({
      ok: true,
      view: 'roles',
    });
  });
});
