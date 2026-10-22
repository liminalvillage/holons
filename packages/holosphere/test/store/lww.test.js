import { wins, newestFirst } from '../../store/lww.js';

describe('store/lww: the one ordering rule', () => {
    test('nothing current → candidate wins', () => {
        expect(wins({ created_at: 1, eventId: 'a' }, null)).toBe(true);
        expect(wins({ created_at: 1, eventId: 'a' }, undefined)).toBe(true);
    });

    test('newer created_at wins regardless of id', () => {
        expect(wins({ created_at: 2, eventId: 'a' }, { created_at: 1, eventId: 'z' })).toBe(true);
        expect(wins({ created_at: 1, eventId: 'z' }, { created_at: 2, eventId: 'a' })).toBe(false);
    });

    test('equal created_at → larger event id wins', () => {
        expect(wins({ created_at: 5, eventId: 'b' }, { created_at: 5, eventId: 'a' })).toBe(true);
        expect(wins({ created_at: 5, eventId: 'a' }, { created_at: 5, eventId: 'b' })).toBe(false);
        expect(wins({ created_at: 5, eventId: 'a' }, { created_at: 5, eventId: 'a' })).toBe(false);
    });

    test('raw writes (empty id) lose ties to signed events and to each other', () => {
        expect(wins({ created_at: 5, eventId: '' }, { created_at: 5, eventId: 'a' })).toBe(false);
        expect(wins({ created_at: 5, eventId: 'a' }, { created_at: 5, eventId: '' })).toBe(true);
        expect(wins({ created_at: 5, eventId: '' }, { created_at: 5, eventId: '' })).toBe(false);
    });

    test('newestFirst sorts by created_at desc then id desc', () => {
        const sorted = [
            { created_at: 1, id: 'a' }, { created_at: 3, id: 'a' }, { created_at: 3, id: 'b' }, { created_at: 2, id: 'z' },
        ].sort(newestFirst);
        expect(sorted.map((e) => `${e.created_at}${e.id}`)).toEqual(['3b', '3a', '2z', '1a']);
    });
});
