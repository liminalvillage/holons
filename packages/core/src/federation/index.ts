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

export {
	applyLensMode,
	lensMode,
	removeFederationPartner,
	sanitizeLenses,
	setFederationPartner,
	type FederationLensMode,
	type SetFederationPartnerOptions
} from './partners.js';

export {
	migrateLegacyFederationLinks,
	type LegacyFederationMigration
} from './legacy.js';

export {
	retractFromFederation,
	type RetractOptions,
	type RetractOutcome
} from './retract.js';
