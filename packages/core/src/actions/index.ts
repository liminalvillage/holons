// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Public surface for `@holons/core/actions`.
//
// The agent-facing side of the task domain: the catalogue of actions an
// agent may call (one definition, every consumer derives its schema from
// it), resolution of spoken references to real records, staging of what an
// action would change, and the commit of approved changes. Pure; consumers
// bring the records and the writer.
export * from './spec.js';
export * from './catalogue.js';
export * from './match.js';
export * from './resolve.js';
export * from './stage.js';
export * from './apply.js';
