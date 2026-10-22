// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The MCP side of the one capability table (@holons/core/holosphere
 * `CAPABILITIES`): before a write the table reserves for a role, ask where
 * this instance's key stands with the holon and refuse with the reason when
 * its signature would be recorded but not counted. Open holons (nobody
 * defined) pass.
 */
import { may, whyNot, writeAcceptance, type Capability, type WriteStanding } from '@holons/core/holosphere';

export interface Gate {
  /** Null when the write would count; otherwise the one sentence to refuse with. */
  refusal: string | null;
  standing: WriteStanding | null;
}

export async function gate(hs: any, holon: string, action: Capability): Promise<Gate> {
  let standing: WriteStanding | null = null;
  try {
    standing = await writeAcceptance(hs, holon);
  } catch {
    standing = null;
  }
  if (!standing) return { refusal: null, standing: null }; // nothing signed to judge by: let the layer below decide
  return { refusal: may(standing, action) ? null : whyNot(standing, action), standing };
}
