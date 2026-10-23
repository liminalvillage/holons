// A read carries the record's field clock (store/clock.js); round-trip
// assertions compare everything else.
export function withoutClock(value) {
    if (!value || typeof value !== 'object') return value;
    const { _clock, ...rest } = value;
    return rest;
}
