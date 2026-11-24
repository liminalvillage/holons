// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Judge a holon's claims log the way every board judges it (shape fold, then ceilings).
import { FLOW_CLAIMS_LENS, foldClaimsFromLenses, loadClaimCeilings, scoreAllocationMembers } from '@holons/core/flows';
import { MEMBERS_LENS, POLICY_LENS, readMembersLog, importPartnerLogs, lensContext } from '@holons/core/protocol';
import { SHIFT_IDENTITY_LENS, attestationsFrom } from '@holons/core/shifts';
export async function judged(hs: any, holon: string) {
  const [entries, policy, settings, users, dir] = await Promise.all([
    hs.getLog(holon, FLOW_CLAIMS_LENS), hs.getLog(holon, POLICY_LENS).catch(() => []), hs.get(holon, 'settings', holon).catch(() => null),
    hs.getAll(holon, 'users').catch(() => []), hs.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
  ]);
  await hs.getAll(holon, MEMBERS_LENS).catch(() => []);
  const membersLog = await readMembersLog(hs, holon);
  const base: any = { holonId: holon, policyEntries: policy, membersLog, settings, users, attestations: attestationsFrom(dir || []) };
  const imports = await importPartnerLogs(hs, FLOW_CLAIMS_LENS, lensContext(base).policyFor(FLOW_CLAIMS_LENS));
  const shape = foldClaimsFromLenses({ ...base, entries, imports });
  const loaded = await loadClaimCeilings(hs, holon, { claims: shape.folded, scoreOf: (id: string) => scoreAllocationMembers(hs, id) } as any);
  return { ctx: foldClaimsFromLenses({ ...base, entries, imports, rights: loaded.ceilings }), ceilings: loaded.ceilings, policy: lensContext(base).policyFor(FLOW_CLAIMS_LENS) };
}
