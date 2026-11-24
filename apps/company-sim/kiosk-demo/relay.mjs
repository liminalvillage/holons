// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A private, in-memory Nostr relay for the Meridian Works kiosk demo. Nothing
// it holds reaches the production relays; stop it and the demo is gone.
//   node apps/company-sim/kiosk-demo/relay.mjs [port]
import { startRelay } from '../../../packages/holosphere/spike/mini-relay.js';
const port = Number(process.argv[2] || 7787);
const relay = await startRelay({ port });
console.log(`meridian demo relay on ws://127.0.0.1:${relay.port ?? port}`);
