import { describe, expect, it } from 'vitest';
import {
  actorDisplayName,
  actorMatchesBooking,
  dayKey,
  findOverlappingBooking,
  getDisplayBookings,
  isBookingActive,
  makeBooking,
  toDayKey,
  withBookings,
  ymd,
  type Booking
} from './bookings.js';

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b-1',
    start: '2099-01-10',
    end: '2099-01-20',
    borrowerId: '20',
    borrower: 'bob',
    borrowerInitials: 'B',
    created: '2099-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('day helpers', () => {
  it('ymd / dayKey / toDayKey normalize to YYYY-MM-DD', () => {
    expect(ymd(new Date(2099, 0, 5))).toBe('2099-01-05');
    expect(dayKey('2099-01-05T12:34:00.000Z')).toBe('2099-01-05');
    expect(dayKey('2099-01-05')).toBe('2099-01-05');
    expect(toDayKey(new Date(2099, 0, 5))).toBe('2099-01-05');
    expect(toDayKey('2099-01-05T12:34:00.000Z')).toBe('2099-01-05');
  });
});

describe('isBookingActive', () => {
  it('is active on the inclusive edges of the range', () => {
    const b = booking();
    expect(isBookingActive(b, new Date(2099, 0, 10))).toBe(true);
    expect(isBookingActive(b, new Date(2099, 0, 20))).toBe(true);
    expect(isBookingActive(b, new Date(2099, 0, 9))).toBe(false);
    expect(isBookingActive(b, new Date(2099, 0, 21))).toBe(false);
  });
});

describe('getDisplayBookings', () => {
  it('returns bookings sorted by start', () => {
    const item = {
      id: 'drill',
      bookings: [booking({ id: 'b', start: '2099-02-01', end: '2099-02-02' }), booking()]
    };
    expect(getDisplayBookings(item).map((b) => b.id)).toEqual(['b-1', 'b']);
  });

  it('synthesizes a legacy booking from single-borrow fields', () => {
    const item = {
      id: 'drill',
      borrowed: true,
      borrower: 'bob',
      borrowerId: 20,
      borrowedAt: '2099-01-10T00:00:00.000Z',
      returnBy: '2099-01-20'
    };
    const [legacy] = getDisplayBookings(item);
    expect(legacy).toMatchObject({
      id: 'legacy',
      start: '2099-01-10',
      end: '2099-01-20',
      borrowerId: '20',
      borrower: 'bob'
    });
  });

  it('ignores legacy fields once a bookings array exists', () => {
    const item = {
      id: 'drill',
      borrowed: true,
      borrowedAt: '2099-01-10',
      bookings: [booking()]
    };
    expect(getDisplayBookings(item)).toHaveLength(1);
    expect(getDisplayBookings(item)[0].id).toBe('b-1');
  });
});

describe('findOverlappingBooking', () => {
  const item = { id: 'drill', bookings: [booking()] };

  it('detects intersecting ranges inclusively and ignores disjoint ones', () => {
    expect(findOverlappingBooking(item, '2099-01-20', '2099-01-25')?.id).toBe('b-1');
    expect(findOverlappingBooking(item, '2099-01-01', '2099-01-10')?.id).toBe('b-1');
    expect(findOverlappingBooking(item, '2099-01-12', '2099-01-13')?.id).toBe('b-1');
    expect(findOverlappingBooking(item, '2099-01-21', '2099-01-30')).toBeNull();
    expect(findOverlappingBooking(item, '2099-01-01', '2099-01-09')).toBeNull();
  });

  it('can exclude a booking from its own reschedule check', () => {
    expect(findOverlappingBooking(item, '2099-01-12', '2099-01-13', 'b-1')).toBeNull();
  });
});

describe('withBookings', () => {
  it('mirrors the booking covering today onto the legacy fields', () => {
    const today = ymd(new Date());
    const active = booking({ start: today, end: today });
    const item = withBookings({ id: 'drill' }, [active]);
    expect(item.borrowed).toBe(true);
    expect(item.borrower).toBe('bob');
    expect(item.borrowerId).toBe('20');
    expect(item.returnBy).toBe(today);
    // borrowedAt is local midnight serialized to ISO (may be the prior UTC day).
    expect(item.borrowedAt).toBe(new Date(`${today}T00:00:00`).toISOString());
  });

  it('clears the mirror when no booking covers today', () => {
    const item = withBookings(
      { id: 'drill', borrowed: true, borrower: 'bob', borrowerId: '20' },
      [booking()] // far-future reservation
    );
    expect(item.borrowed).toBe(false);
    expect(item.borrower).toBeNull();
    expect(item.borrowerId).toBeNull();
    expect(item.returnBy).toBeNull();
    expect(item.bookings).toHaveLength(1);
  });
});

describe('actor identity', () => {
  it('actorDisplayName prefers display_name, then username without @, then names, then id', () => {
    expect(actorDisplayName({ id: 1, username: 'bob', display_name: 'Bob the Builder' })).toBe(
      'Bob the Builder'
    );
    expect(actorDisplayName({ id: 1, username: '@bob' })).toBe('bob');
    expect(actorDisplayName({ id: 1, first_name: 'Bob', last_name: 'Kane' })).toBe('Bob Kane');
    expect(actorDisplayName({ id: 42 })).toBe('42');
  });

  it('actorMatchesBooking matches by id and by @-tolerant name', () => {
    const byWeb = booking({ borrowerId: '20', borrower: '@Bob' });
    expect(actorMatchesBooking(byWeb, { id: 20, username: 'other' })).toBe(true);
    expect(actorMatchesBooking(byWeb, { id: 99, username: 'bob' })).toBe(true);
    expect(actorMatchesBooking(byWeb, { id: 99, display_name: '@bob' })).toBe(true);
    expect(actorMatchesBooking(byWeb, { id: 99, username: 'eve' })).toBe(false);

    const byNostr = booking({ borrowerId: 'npub123', borrower: 'liminal' });
    expect(actorMatchesBooking(byNostr, { id: 'npub123' })).toBe(true);
    expect(actorMatchesBooking(byNostr, { id: 'npub999', display_name: 'Liminal' })).toBe(true);
  });
});

describe('makeBooking', () => {
  it('stamps identity, initials, normalized days, and a unique id', () => {
    const b = makeBooking(
      { id: 20, username: 'bob', first_name: 'Bob', last_name: 'Kane' },
      '2099-01-10T09:00:00.000Z',
      '2099-01-20'
    );
    expect(b.start).toBe('2099-01-10');
    expect(b.end).toBe('2099-01-20');
    expect(b.borrowerId).toBe('20');
    expect(b.borrower).toBe('bob');
    expect(b.borrowerInitials).toBe('BK');
    expect(b.id).toMatch(/^b-/);
    expect(new Date(b.created).getTime()).not.toBeNaN();
  });
});
