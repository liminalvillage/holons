// Re-export from @holons/core/shopping. The canonical ShoppingItem + ShoppingChecklist
// types live in packages/core/src/shopping/ so web and telegram UIs share one shape.
export type { ShoppingItem, ShoppingChecklist } from '@holons/core/shopping';
