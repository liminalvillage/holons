// iCal Feed Server Endpoint
// Serves the holon's calendar as an iCal feed for external subscription

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateICalFeed } from '$lib/services/icalGenerator';
import HoloSphere from 'holosphere';

// Initialize HoloSphere instance for server-side data access
// Default to production environment for iCal feed endpoint
const holosphere = new HoloSphere('Holons');

export const GET: RequestHandler = async ({ params }) => {
    const holonId = params.id;

    if (!holonId) {
        throw error(400, 'Holon ID is required');
    }

    try {
        // Fetch holon data to get the name
        const holonData = await holosphere.get(holonId, 'profile', holonId);
        const holonName = holonData?.name || holonData?.title || 'Holon Calendar';

        // Fetch all quests/events from the holon
        const quests = await holosphere.getAll(holonId, 'quests');

        // Filter events that have a 'when' field (are scheduled)
        const scheduledEvents = (quests || []).filter((quest: any) => quest.when);

        // Generate the iCal feed
        const icalContent = generateICalFeed(scheduledEvents, holonName, holonId);

        // Return the iCal feed with proper headers
        return new Response(icalContent, {
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': `attachment; filename="${holonName.replace(/[^a-z0-9]/gi, '_')}.ics"`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (err) {
        console.error('Error generating iCal feed:', err);
        throw error(500, 'Failed to generate calendar feed');
    }
};
