// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/flows — the value-flow graph model.
 *
 * Two different questions get answered with the same shape, so one layout and
 * one renderer serve both:
 *
 *   movement   — what came in and went out (sources -> holon -> sinks)
 *   allocation — where the holon's resources are distributed
 *                (pot -> interior/exterior -> members/zones -> partners)
 *
 * Names are prefixed `ValueFlow*` on purpose. `@holons/core/settings` already
 * owns `FlowNode`/`FlowEdge`/`FlowMetrics` for the on-chain token-split model
 * behind the dashboard's `/[id]/flow`; these are a different thing and must not
 * be mistaken for it.
 *
 * Tracks never mix units. Appreciation is not hours and hours are not euros, and
 * this repo has no exchange rates, so a track carries its own unit and nothing
 * ever sums across tracks. A holon holding two currencies gets two money tracks.
 */

/** Which kind of value a track measures. Money tracks carry the code in `unit`. */
export type TrackId = 'money' | 'time' | 'appreciation' | 'allocation';

/**
 * A node in one column of the diagram.
 *
 * `depth` is assigned by the builder, not inferred: these graphs are known
 * shapes (a 3-column fan-in/fan-out, a 4-column allocation tree), so there is
 * no need for a general DAG ranking pass.
 */
export interface ValueFlowNode {
	id: string;
	/** Display text. Builders emit real names; UIs translate what they own. */
	label: string;
	/** Column index; 0 is leftmost. */
	depth: number;
	/** Total flowing through this node — the max of its in and out sides. */
	value: number;
	/** What produced it: 'opencollective' | 'expense' | 'library' | 'treasury' | … */
	kind?: string;
}

/** A ribbon between two nodes. Zero-value links are dropped at build time. */
export interface ValueFlowLink {
	id: string;
	source: string;
	target: string;
	/** Always > 0. */
	value: number;
	kind?: string;
}

/** One unit-coherent diagram. */
export interface ValueFlowTrack {
	id: TrackId;
	/** Currency code, 'hours', 'kudos', or '' for a percentage-only allocation. */
	unit: string;
	nodes: ValueFlowNode[];
	links: ValueFlowLink[];
	totalIn: number;
	totalOut: number;
	/** Standing balance where one exists (money with OpenCollective), else null. */
	balance: number | null;
}

/** Every track for one holon over one window. */
export interface ValueFlowGraph {
	holonId: string;
	/** Window bounds, ms epoch. `from` is 0 for an all-time window. */
	from: number;
	to: number;
	tracks: ValueFlowTrack[];
}
