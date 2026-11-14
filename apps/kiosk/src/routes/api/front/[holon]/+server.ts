// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/front/<holon> — a holon's public front page (its DNA, how joining
// works) as JSON, readable from any origin. The contract is
// `packages/core/schemas/holon-front.schema.json`; the behaviour — enforced
// reads, bounded catch-up, CORS, cache headers — is `$lib/server/front`.

import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { createFrontService, deployedHolosphere } from "$lib/server/front";

/** One service per function instance: a cold start catches the holon up, a warm one reuses it. */
const front = createFrontService({ holosphere: () => deployedHolosphere(env) });

export const GET: RequestHandler = ({ params }) => front.get(params.holon);
export const OPTIONS: RequestHandler = () => front.options();
