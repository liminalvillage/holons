# Licensing

Holons is **dual-licensed**. You may use it under **either** of the following,
at your option:

1. **Open source — GNU AGPL-3.0-or-later** (default).
   The full text is in [`LICENSE.md`](./LICENSE.md). This is the license that
   applies to everyone by default, including all public copies on GitHub.

2. **Commercial license** — a separate, paid license from the Licensor for
   organizations that cannot or do not wish to comply with the AGPL (for
   example, embedding Holons in a closed-source product or SaaS without
   releasing their own modifications). See
   [`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md).

You only need a commercial license if the AGPL's obligations do not work for
your use case. **If you are unsure, the AGPL applies** — you do not need to ask
permission to use, modify, self-host, or contribute to Holons under the AGPL.

## What the AGPL requires (plain-language summary, not legal advice)

- You can use, study, modify, and redistribute Holons freely.
- If you distribute Holons or a modified version, you must provide the
  corresponding source under the AGPL.
- **Network/SaaS clause (AGPL §13):** if you run a modified version of Holons
  as a network service, you must offer that service's users the modified
  source. This is the key difference from the GPL and the reason a commercial
  license exists.

The authoritative terms are in [`LICENSE.md`](./LICENSE.md); this summary is
only an orientation.

## SPDX identifiers

Every source file should carry an SPDX header so the license is
machine-detectable and unambiguous:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
```

`package.json` files use the SPDX expression `"license": "AGPL-3.0-or-later"`.
The commercial option is offered out-of-band (it is a private agreement) and is
intentionally **not** encoded as an SPDX `OR` expression in package metadata, so
that automated tooling treats the public package as plain AGPL.

## The Licensors

Holons is owned **personally** by its author and operated commercially by a
company under an exclusive license, with a non-profit stewarding the
open-source side:

> **IP owner & copyright holder:** **Roberto Valenti** — sole author and
> original copyright holder. Roberto retains bare legal title to the Work.
>
> **Exclusive, irrevocable commercial operator:** **Rigenerativa SRL** —
> holds an **exclusive, irrevocable, perpetual, sublicensable license** to
> Holons from Roberto Valenti (see
> [`legal/exclusive-license-agreement.md`](./legal/exclusive-license-agreement.md)).
> Acts as the project's commercial operator: grants the paid
> [commercial license](./LICENSE-COMMERCIAL.md), receives all new
> contributions via the [Contributor License Agreement](./CLA.md), and
> sublicenses the non-commercial side to the non-profit below.
>
> **Non-commercial / open-source operator:** **Regenerativa APS-ETS** (a
> non-profit *Associazione di Promozione Sociale – Ente del Terzo Settore*).
> Sublicensed by Rigenerativa SRL to steward Holons for everyone under the
> [AGPL-3.0-or-later](./LICENSE.md) and run the community/commons side. It
> does not own the IP and does not earn commercial revenue, which keeps its
> non-profit/ETS status clean.
>
> **Contact (all):** we@holons.io

```
                                Roberto Valenti
                          (sole author, copyright holder)
                                       │
                                       │ exclusive, irrevocable, sublicensable
                                       │ license  (see legal/exclusive-license-agreement.md)
                                       ▼
                  contributions     Rigenerativa SRL
   contributors ─────(via CLA)───▶   commercial operator,
                                     grants commercial license,
                                     dual-license aggregator
                                       │ non-commercial sublicense
                                       ▼
                                Regenerativa APS-ETS
                             non-commercial / AGPL steward
                  ┌────────────────────┴────────────────────┐
                  ▼                                         ▼
         everyone, under AGPL                  customers, under a paid
      (stewarded by the APS-ETS)         commercial agreement with the SRL
```

Roberto keeps title to the underlying IP; the SRL runs commercial licensing
under an exclusive license from him; the APS-ETS runs the commons under a
non-commercial sublicense from the SRL. The [CLA](./CLA.md) assigns new
contributions to **Rigenerativa SRL**, which — combining its exclusive license
to the original code with its ownership of contributions — has the full rights
needed to operate the dual-license model. The license-not-assignment structure
avoids triggering a personal IP-transfer event today, and §8.2 of the exclusive
license preserves the option to convert into a full assignment later.

If an entity name changes, update it only where its role appears:

| Role | Entity | Appears in |
| --- | --- | --- |
| IP owner / copyright / SPDX | Roberto Valenti | source `SPDX-FileCopyrightText` headers, `README.md`, this file, `legal/exclusive-license-agreement.md` |
| CLA assignee / commercial operator | Rigenerativa SRL | `README.md`, this file, `CLA.md`, [`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md), `legal/*.md` |
| Non-commercial / AGPL operator | Regenerativa APS-ETS | `README.md`, this file, `CLA.md`, `legal/noncommercial-license-srl-to-aps.md` |

Nothing else depends on the names, so a change is a scoped find-and-replace
plus the corresponding IP-assignment / inter-company license record.

## Why dual-licensed?

The AGPL keeps Holons and every networked deployment of it open, which protects
the commons and the contributors. The commercial license lets organizations
that genuinely cannot adopt the AGPL still fund the project on fair terms. Both
halves require that the Licensor can relicense contributions — which is why all
contributions are made under the [CLA](./CLA.md).
