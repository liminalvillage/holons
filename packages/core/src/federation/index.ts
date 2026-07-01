/**
 * @holons/core/federation
 *
 * Shared federation publishing primitives. UI-agnostic: callers inject the
 * federation source id and (optionally) a write-denied notifier.
 */

export {
	publishToFederation,
	type PublishContext,
	type PublishOptions,
	type PublishOutcome,
	type PublishTarget
} from './publish.js';

export {
	getFederationSnapshot,
	type FederationSnapshot,
	type FederationLensDirections
} from './snapshot.js';

export { readSettingsHex } from './settings-hex.js';
