import HoloSphere from '../holosphere.js';

describe('HoloSphere', () => {
    let holoSphere;

    beforeEach(() => {
        holoSphere = new HoloSphere('test-app', {
            gunPeers: ['http://localhost:8765/gun'],
        });
    });

    test('initialization', () => {
        expect(holoSphere).toBeDefined();
        expect(holoSphere.users).toEqual({});
        expect(holoSphere.hexagonVotes).toEqual({});
    });

    test('voting system', async () => {
        const userId = 'test-user';
        const hexId = '8928308280fffff';
        const topic = 'test-topic';
        const vote = 'yes';

        await holoSphere.initializeUser(userId);
        await holoSphere.vote(userId, hexId, topic, vote);

        const votes = holoSphere.aggregateVotes(hexId, topic);
        expect(votes).toHaveProperty('yes', 1);
    });

    // Add more tests...
}); 