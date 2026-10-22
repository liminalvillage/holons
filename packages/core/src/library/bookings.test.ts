import { describe, expect, it } from 'vitest';
import {
  actorMatchesBooking,
  bookingBound,
  bookingSpan,
  bookingStatus,
  dayKey,
  findOverlappingBooking,
  getDisplayBookings,
  isBookingActive,
  isTimedBooking,
  makeBooking,
  minuteKey,
  returnableBooking,
  timeOf,
  toBound,
  toDayKey,
  wallClock,
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
    expect(b.borrower).toBe('Bob Kane'); // the one name rule: real name before handle
    expect(b.borrowerInitials).toBe('BK');
    expect(makeBooking({ id: 21, username: '@ann' }, '2099-01-10', '2099-01-11').borrower).toBe('ann');
    expect(makeBooking({ id: 22, display_name: 'Resolved Name', username: 'x' }, '2099-01-10', '2099-01-11').borrower).toBe('Resolved Name');
    expect(b.id).toMatch(/^b-/);
    expect(new Date(b.created).getTime()).not.toBeNaN();
  });
});

describe('timed bookings', () => {
  const hour = booking({ id: 'car', start: '2099-01-10T14:00', end: '2099-01-10T15:00' });

  it('tells a timed bound from a day, and builds one from a day + time', () => {
    expect(isTimedBooking(hour)).toBe(true);
    expect(isTimedBooking(booking())).toBe(false);
    expect(timeOf(hour.start)).toBe('14:00');
    expect(timeOf('2099-01-10')).toBe('');
    // A full ISO instant (legacy data) is a day, never a timed bound.
    expect(timeOf('2099-01-10T14:00:00.000Z')).toBe('');
    expect(bookingBound('2099-01-10', '14:00')).toBe('2099-01-10T14:00');
    expect(bookingBound('2099-01-10', '')).toBe('2099-01-10');
    expect(minuteKey(new Date(2099, 0, 10, 9, 5))).toBe('2099-01-10T09:05');
    expect(toBound('2099-01-10T14:00')).toBe('2099-01-10T14:00');
    expect(toBound(new Date(2099, 0, 10, 14, 0))).toBe('2099-01-10');
  });

  it('spans a whole day end to end and a timed stretch as given', () => {
    expect(bookingSpan(booking())).toEqual({ from: '2099-01-10T00:00', to: '2099-01-20T24:00' });
    expect(bookingSpan(hour)).toEqual({ from: '2099-01-10T14:00', to: '2099-01-10T15:00' });
  });

  it('is active from its start up to, not including, its end', () => {
    expect(isBookingActive(hour, new Date(2099, 0, 10, 13, 59))).toBe(false);
    expect(isBookingActive(hour, new Date(2099, 0, 10, 14, 0))).toBe(true);
    expect(isBookingActive(hour, new Date(2099, 0, 10, 14, 59))).toBe(true);
    expect(isBookingActive(hour, new Date(2099, 0, 10, 15, 0))).toBe(false);
  });

  it('lets back-to-back hours stand, and collides with a day booking on that day', () => {
    const item = { id: 'car', bookings: [hour] };
    expect(findOverlappingBooking(item, '2099-01-10T15:00', '2099-01-10T16:00')).toBeNull();
    expect(findOverlappingBooking(item, '2099-01-10T13:00', '2099-01-10T14:00')).toBeNull();
    expect(findOverlappingBooking(item, '2099-01-10T14:30', '2099-01-10T15:30')?.id).toBe('car');
    expect(findOverlappingBooking(item, '2099-01-10', '2099-01-10')?.id).toBe('car');
    expect(findOverlappingBooking(item, '2099-01-11', '2099-01-12')).toBeNull();
    // A stretch ending at midnight leaves the next day free.
    const late = { id: 'car', bookings: [booking({ start: '2099-01-10T22:00', end: '2099-01-11T00:00' })] };
    expect(findOverlappingBooking(late, '2099-01-11', '2099-01-11')).toBeNull();
  });

  it('mirrors a timed booking into the legacy fields with its real times', () => {
    const now = new Date();
    const start = minuteKey(new Date(now.getTime() - 60_000));
    const end = minuteKey(new Date(now.getTime() + 3_600_000));
    const item = withBookings({ id: 'car' }, [booking({ start, end })]);
    expect(item.borrowed).toBe(true);
    expect(item.returnBy).toBe(end);
    expect(item.borrowedAt).toBe(new Date(start).toISOString());
  });
});

describe('bookingStatus / returnableBooking', () => {
  const bob = { id: 20, username: 'bob' };
  const at = new Date(2099, 0, 10, 14, 30);

  it('reads the state from bookings, not from the stored mirror', () => {
    const next = booking({ id: 'later', start: '2099-01-12', end: '2099-01-13' });
    // The mirror says "borrowed" but nothing covers now: the write is stale.
    expect(bookingStatus({ id: 'x', borrowed: true, bookings: [next] }, at)).toEqual({
      state: 'available',
      booking: null,
      next
    });
    const hour = booking({ id: 'car', start: '2099-01-10T14:00', end: '2099-01-10T15:00' });
    // ...and "not borrowed" while a booking has started since.
    const out = bookingStatus({ id: 'x', borrowed: false, bookings: [hour, next] }, at);
    expect(out.state).toBe('out');
    expect(out.booking?.id).toBe('car');
    expect(out.next?.id).toBe('later');
  });

  it('is overdue with the last holder once their time is up, until the next booking begins', () => {
    const lapsed = booking({ id: 'old', start: '2099-01-10T12:00', end: '2099-01-10T13:00' });
    const item = { id: 'x', bookings: [lapsed] };
    expect(bookingStatus(item, at)).toMatchObject({ state: 'overdue', booking: { id: 'old' } });
    const eve = booking({ id: 'eve', borrowerId: '30', start: '2099-01-10T14:00', end: '2099-01-10T16:00' });
    expect(bookingStatus({ id: 'x', bookings: [lapsed, eve] }, at)).toMatchObject({
      state: 'out',
      booking: { id: 'eve' }
    });
  });

  it('picks the booking an actor returns: theirs covering now, else their last lapsed one', () => {
    const lapsed = booking({ id: 'old', start: '2099-01-08', end: '2099-01-09' });
    const live = booking({ id: 'live', start: '2099-01-10T14:00', end: '2099-01-10T15:00' });
    const future = booking({ id: 'future', start: '2099-02-01', end: '2099-02-02' });
    const item = { id: 'x', bookings: [lapsed, live, future] };
    expect(returnableBooking(item, bob, at)?.id).toBe('live');
    expect(returnableBooking({ id: 'x', bookings: [lapsed, future] }, bob, at)?.id).toBe('old');
    expect(returnableBooking({ id: 'x', bookings: [future] }, bob, at)).toBeNull();
    expect(returnableBooking(item, { id: 99, username: 'mallory' }, at)).toBeNull();
    // Ids match across number/string — a Telegram id is a number on one
    // surface and a string on the booking.
    expect(returnableBooking(item, { id: '20' }, at)?.id).toBe('live');
  });
});

describe('wallClock', () => {
  it('reads the clock of the holon\'s zone, whatever the host\'s', () => {
    const instant = new Date('2099-01-10T23:30:00.000Z');
    expect(minuteKey(wallClock(instant, 'Europe/Rome'))).toBe('2099-01-11T00:30');
    expect(minuteKey(wallClock(instant, 'UTC'))).toBe('2099-01-10T23:30');
  });

  it('falls back to the host clock for a missing or unknown zone', () => {
    const instant = new Date(2099, 0, 10, 9, 0);
    expect(wallClock(instant, '')).toBe(instant);
    expect(wallClock(instant, 'Not/AZone')).toBe(instant);
  });
});

describe('legacy borrow without dates', () => {
  it('reads as out today, held by its borrower', () => {
    const item = { id: 'drill', borrowed: true, borrower: 'Dario', borrowerId: 7 };
    const status = bookingStatus(item);
    expect(status.state).toBe('out');
    expect(status.booking).toMatchObject({ id: 'legacy', borrower: 'Dario', borrowerId: '7' });
    expect(returnableBooking(item, { id: 7 })?.id).toBe('legacy');
  });
});
