# Legal — chain of title for Holons

These documents are the **paper trail** behind the licensing model described
in [`../LICENSING.md`](../LICENSING.md) and [`../CLA.md`](../CLA.md).
Together they establish, on paper, what the repository asserts in code
(SPDX headers, the `©` line, the CLA Licensor):

```
Roberto Valenti ──[1] exclusive,         Rigenerativa SRL
 (sole author,        irrevocable,        (single Licensor:
  ~2016–2026,         sublicensable       AGPL publisher,
  retains             license────▶)        commercial licensor,
  copyright)                              CLA licensee)

future external
contributors ──────[CLA, see ../CLA.md]──▶ Rigenerativa SRL
```

| # | Document | Parties | Purpose |
| --- | --- | --- | --- |
| 1 | [`exclusive-license-agreement.md`](./exclusive-license-agreement.md) | Roberto Valenti → **Rigenerativa SRL** | Grants an exclusive, irrevocable, perpetual, sublicensable license to the entire pre-existing Holons codebase. Roberto retains bare legal title; the SRL operates the dual-license model. Symbolic €100/year royalty defuses re-characterization-as-assignment risk. |
| — | [`../CLA.md`](../CLA.md) | future contributors → Rigenerativa SRL | Covers contributions made *after* publication. |

## Status & how to use

- This is an **unexecuted template**. Sign and date with the authorized
  signatories (Roberto Valenti personally; the SRL's *amministratore unico*).
- Have an Italian **commercialista / avvocato** review them. The license-only
  structure is designed to avoid the transfer/realization event a full IP
  assignment would create, but **the Agenzia delle Entrate may re-characterize
  a too-generous license as a de-facto assignment** — the nominal royalty in
  §5 of the exclusive license is meant to mitigate this. Confirm the figure
  (and whether to register the agreement at the *Agenzia delle Entrate* for
  date certainty / *imposta di registro*) with counsel.
- Keep **executed, signed copies private** — do not commit scans/PDFs with
  signatures, personal addresses, or tax codes to a public repository.
  `legal/executed/` is git-ignored for this reason; store signed originals
  there or outside the repo.
- Italian-law notes baked into the templates: economic rights are
  assignable/licensable in writing (art. 110 L. 633/1941); **moral rights are
  inalienable** (art. 20–22 L. 633/1941) — handled via a non-assertion
  covenant, not a waiver.
- Upgrade path: if a future investment or corporate event makes the tax cost
  of a full assignment worth paying, the exclusive license can be converted
  into an outright assignment via a separate instrument (see §8.2 of the
  exclusive license).

*This folder documents corporate chain of title. It is not legal advice.*
