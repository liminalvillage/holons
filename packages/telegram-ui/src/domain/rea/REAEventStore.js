/**
 * @fileoverview REA Event Store — thin re-export of the canonical
 * implementation in `@holons/core/rea`. Preserved as a local module so any
 * existing import paths inside telegram-ui keep resolving.
 *
 * @deprecated Use `@holons/core/rea` directly.
 * @module src/domain/rea/REAEventStore
 */

export { REAEventStore } from '@holons/core/rea';
export { REAEventStore as default } from '@holons/core/rea';
