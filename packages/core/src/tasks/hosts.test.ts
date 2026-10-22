// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { addHost, creditedMembers, hostsOf, isHost, removeHost, toggleHost } from './hosts.js';
import type { Quest } from './types.js';

const ada = { id: 7, username: 'ada' };
const bo = { id: 9, first_name: 'Bo' };

function event(extra: Partial<Quest> = {}): Quest {
  return { id: 'e1', title: 'Full moon dinner', type: 'event', status: 'ongoing', participants: [], ...extra };
}

describe('hostsOf', () => {
  it('is the host list of an event', () => {
    expect(hostsOf(event({ hosts: [ada, bo] }))).toEqual([ada, bo]);
  });

  it('is empty when nobody is named — the initiator is not a host', () => {
    expect(hostsOf(event({ initiator: ada }))).toEqual([]);
    expect(hostsOf(event({ initiator: ada, hosts: [] }))).toEqual([]);
  });

  it('is empty for anything that is not an event', () => {
    expect(hostsOf(event({ type: 'task', hosts: [ada], initiator: ada }))).toEqual([]);
    expect(hostsOf(event({ type: 'offer', hosts: [ada] }))).toEqual([]);
  });

  it('tolerates the wire format: a JSON string, entries without an id, repeats', () => {
    expect(hostsOf(event({ hosts: JSON.stringify([ada]) }))).toEqual([ada]);
    expect(hostsOf(event({ hosts: [{ username: 'ghost' }, bo, { id: '9' }] }))).toEqual([bo]);
  });
});

describe('editing the host list', () => {
  it('adds once, removes, toggles', () => {
    const one = addHost(event(), ada);
    expect(one.hosts).toEqual([ada]);
    expect(addHost(one, { id: '7' }).hosts).toEqual([ada]);
    expect(removeHost(one, 7).hosts).toEqual([]);
    expect(toggleHost(one, bo).hosts).toEqual([ada, bo]);
    expect(toggleHost(one, ada).hosts).toEqual([]);
  });

  it('does not mutate its input', () => {
    const before = event({ hosts: [ada] });
    addHost(before, bo);
    expect(before.hosts).toEqual([ada]);
  });

  it('isHost follows hostsOf', () => {
    expect(isHost(event({ hosts: [ada] }), '7')).toBe(true);
    expect(isHost(event({ initiator: ada }), 7)).toBe(false);
  });
});

describe('creditedMembers', () => {
  it('is the hosts when an event names any', () => {
    expect(creditedMembers(event({ hosts: [ada], participants: [bo] }))).toEqual([ada]);
  });

  it('is everyone who took part otherwise', () => {
    expect(creditedMembers(event({ participants: [ada, bo] }))).toEqual([ada, bo]);
    expect(creditedMembers(event({ hosts: [], participants: [bo] }))).toEqual([bo]);
  });

  it('ignores a host list on a task', () => {
    expect(creditedMembers(event({ type: 'task', hosts: [ada], participants: [bo] }))).toEqual([bo]);
  });
});
