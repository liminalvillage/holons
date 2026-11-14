// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/dna — a holon's DNA: genes (its purpose, values, agreements,
// practices, roles, tools, terms) holding alleles, stored one record per
// gene in the `genes` lens, and the hash that names one version of it.

export {
  ACK_MODES,
  GENE_KINDS,
  GENE_KIND_DEFAULTS,
  GENE_LIMITS,
  GeneInvalid,
  SINGLE_KINDS,
  type AckMode,
  type Allele,
  type AlleleDetail,
  type AlleleIcon,
  type Gene,
  type GeneDraft,
  type GeneIssue,
  type GeneIssueCode,
  type GeneKind,
  type GeneLink,
} from './types.js';

export { ALLELE_ICONS, isAlleleIcon } from './icons.js';

export {
  GENES_LENS,
  geneBytes,
  geneSlug,
  normalizeGene,
  purposeAbout,
  putGene,
  readGenes,
  removeGene,
  reorderGenes,
  sortGenes,
  subscribeGenes,
  validateGene,
  validateGenes,
  type GeneWriteOptions,
} from './genes.js';

export { canonicalJson, dnaHash, geneHash, hashedView, shortHash } from './version.js';

export { STARTER_GENES, STARTER_LANGS, type StarterLang } from './templates.js';

export {
  acknowledgeStep,
  emptyWalkState,
  normalizeWalkState,
  unacknowledgeStep,
  walkProgress,
  walkSteps,
  type WalkProgress,
  type WalkState,
  type WalkStep,
} from './walk.js';

export {
  FRONT_CATCH_UP_MS,
  FRONT_TEASER_CHARS,
  HOLON_FRONT_SCHEMA,
  HolonFrontUnreachable,
  WORDS_PER_MINUTE,
  buildHolonFront,
  countWords,
  readHolonFront,
  readingMinutes,
  teaserOf,
  type AlleleView,
  type FrontCta,
  type FrontRef,
  type GeneLayout,
  type GeneView,
  type HolonFront,
  type HolonFrontInput,
  type HolonFrontViewer,
  type HowStep,
  type ReadHolonFrontOptions,
} from './front.js';
