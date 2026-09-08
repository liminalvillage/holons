// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @fileoverview Telegram UI for the stock shelf: fungible inventory kept in
 * quantity (kilos of flour, litres of oil, boxes of screws).
 *
 * Every number comes from `@holons/core/inventory`: levels are folded from
 * the holon's REA events and never stored, the buy list is derived from the
 * restock targets, and the federation moves come from core's transport
 * plan. This module only parses commands and renders text.
 *
 *   /stock                          the shelf
 *   /stock add <qty> <item> [note]  record produced (+); creates the item
 *   /stock use <qty> <item> [note]  record consumed (−)
 *   /stock count <qty> <item>       count correction
 *   /stock target <qty> <item>      restock level
 *   /stock keep <qty> <item>        keep-back floor
 *   /stock reorder [buy]            the buy list; `buy` writes it to /shopping
 *   /stock moves                    shortages and the federation rebalance plan
 *
 * @module src/Stock
 */

import { Markup } from 'telegraf';
import * as utils from './utilities.js';
import { REAEventStore } from '@holons/core/rea';
import { getFederationSnapshot } from '@holons/core/federation';
import {
  STOCK_LENS,
  buildStockEvent,
  correctionKind,
  createStockItemSpec,
  demandsOf,
  federationCost,
  foldStock,
  positions,
  readStockItemSpecs,
  rebalancePlan,
  reorderList,
  reserve,
  scarcity,
  stockItemId,
  syncReorderToShopping,
  updateStockItemSpec,
  type PartnerGraph,
  type ReorderLine,
  type ScarcityEntry,
  type StockEventLike,
  type StockItemSpecRecord,
  type StockLevel,
  type StockPosition,
  type StockTransfer,
} from '@holons/core/inventory';

// ----------------------------------------------------------------------------
// Local types (UI-only; bot/db are duck-typed like every other feature)
// ----------------------------------------------------------------------------

interface DB {
  get(holonId: string, lens: string, id: string): Promise<any>;
  getAll(holonId: string, lens: string): Promise<any[]>;
  put(holonId: string, lens: string, value: any): Promise<unknown>;
  delete(holonId: string, lens: string, id: string): Promise<unknown>;
}

interface Settings {
  getLanguage(holonId: string | number): Promise<string>;
}

interface BotLike {
  command(name: string | string[], handler: (ctx: any) => unknown): unknown;
  action(matcher: string | RegExp, handler: (ctx: any) => unknown): unknown;
}

interface AnyCtx {
  chat?: { id: number | string };
  callbackQuery?: { message?: { chat?: { id: number | string } } };
  from?: { id: number; username?: string; first_name?: string };
  message?: { text?: string };
  reply: (text: string, extra?: unknown) => Promise<unknown>;
  answerCbQuery?: (text?: string) => Promise<unknown>;
}

// ----------------------------------------------------------------------------
// Parsing — pure, exported for tests
// ----------------------------------------------------------------------------

export type StockSubcommand =
  | 'shelf'
  | 'add'
  | 'use'
  | 'count'
  | 'target'
  | 'keep'
  | 'reorder'
  | 'moves'
  | 'help';

/** Units we recognise when they follow the number as a separate word. */
export const KNOWN_UNITS: ReadonlySet<string> = new Set([
  'kg',
  'g',
  'mg',
  'l',
  'ml',
  'cl',
  'm',
  'cm',
  'mm',
  'pcs',
  'pc',
  'pack',
  'packs',
  'box',
  'boxes',
  'bag',
  'bags',
  'bottle',
  'bottles',
  'can',
  'cans',
  'jar',
  'jars',
  'roll',
  'rolls',
  'unit',
  'units',
  'one',
]);

/** Word aliases for the subcommands, so `/stock usa 2 farina` also works. */
const SUBCOMMANDS: Record<string, StockSubcommand> = {
  add: 'add',
  in: 'add',
  produced: 'add',
  aggiungi: 'add',
  añadir: 'add',
  agregar: 'add',
  use: 'use',
  out: 'use',
  used: 'use',
  consume: 'use',
  usa: 'use',
  usar: 'use',
  count: 'count',
  set: 'count',
  conta: 'count',
  contar: 'count',
  target: 'target',
  restock: 'target',
  obiettivo: 'target',
  objetivo: 'target',
  keep: 'keep',
  min: 'keep',
  floor: 'keep',
  tieni: 'keep',
  mantener: 'keep',
  reorder: 'reorder',
  buy: 'reorder',
  riordina: 'reorder',
  reordenar: 'reorder',
  moves: 'moves',
  move: 'moves',
  plan: 'moves',
  spostamenti: 'moves',
  movimientos: 'moves',
  help: 'help',
  '?': 'help',
};

export interface ParsedCommand {
  sub: StockSubcommand;
  /** Everything after the subcommand, trimmed. */
  rest: string;
  /** For `reorder`: the `buy` flag. */
  flag?: string;
}

/** `/stock@BotName add 5kg flour` → { sub: 'add', rest: '5kg flour' }. */
export function parseStockCommand(text: string): ParsedCommand {
  const body = (text ?? '')
    .trim()
    .replace(/^\/\S+\s*/, '')
    .trim();
  if (!body) return { sub: 'shelf', rest: '' };
  const [first, ...others] = body.split(/\s+/);
  const sub = SUBCOMMANDS[first.toLowerCase()];
  if (!sub) return { sub: 'help', rest: body };
  const rest = others.join(' ').trim();
  if (sub === 'reorder') {
    const flag = rest.toLowerCase();
    return { sub, rest: '', ...(flag ? { flag } : {}) };
  }
  return { sub, rest };
}

export interface ParsedQuantityLine {
  quantity: number;
  /** Unit written right after the number (`5kg`, `2 l`); undefined otherwise. */
  unit?: string;
  item: string;
  note?: string;
}

const NOTE_SEPARATORS = [' — ', ' - ', ' – ', ', ', ': ', ' #'];

/**
 * Split the item name from the note. A quoted item wins; then an explicit
 * separator; then the longest known item name at the start of the line;
 * otherwise the whole line is the item.
 */
export function splitItemAndNote(
  line: string,
  known: ReadonlyArray<string> = []
): { item: string; note?: string } {
  const text = line.trim();
  const quoted = text.match(/^["“'‘](.+?)["”'’]\s*(.*)$/);
  if (quoted) {
    return {
      item: quoted[1].trim(),
      ...(quoted[2].trim() ? { note: quoted[2].trim() } : {}),
    };
  }
  for (const sep of NOTE_SEPARATORS) {
    const at = text.indexOf(sep);
    if (at > 0) {
      const item = text.slice(0, at).trim();
      const note = text.slice(at + sep.length).trim();
      return { item, ...(note ? { note } : {}) };
    }
  }
  const lower = text.toLowerCase();
  let best = '';
  for (const name of known) {
    const n = name.trim().toLowerCase();
    if (!n || n.length <= best.length) continue;
    if (lower === n || lower.startsWith(n + ' ')) best = n;
  }
  if (best) {
    const item = text.slice(0, best.length).trim();
    const note = text.slice(best.length).trim();
    return { item, ...(note ? { note } : {}) };
  }
  return { item: text };
}

/** Spellings of "pieces" that mean the default unit. */
const UNIT_ALIASES: Record<string, string> = {
  x: 'one',
  pc: 'one',
  pcs: 'one',
  unit: 'one',
  units: 'one',
  pz: 'one',
  ud: 'one',
  uds: 'one',
  lt: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  kgs: 'kg',
  gr: 'g',
};

export function normalizeUnit(unit: string): string {
  const u = unit.trim().toLowerCase();
  return UNIT_ALIASES[u] ?? u;
}

/**
 * `5kg flour fresh batch` → { quantity: 5, unit: 'kg', item: 'flour', note }.
 * Accepts `5`, `5kg`, `5 kg`, `2,5`, `2.5l`. A word glued to the number is
 * its unit when we know it, or when it is short and something follows
 * (`5pz screws`); `2eggs` stays an item. Null when no number leads the line
 * or nothing follows it.
 */
export function parseQuantityLine(
  rest: string,
  known: ReadonlyArray<string> = []
): ParsedQuantityLine | null {
  const m = (rest ?? '')
    .trim()
    .match(/^(\d+(?:[.,]\d+)?)([a-zA-Zµ]+)?(?:\s+|$)(.*)$/s);
  if (!m) return null;
  const quantity = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  let unit: string | undefined;
  let remainder = (m[3] ?? '').trim();
  const glued = m[2];
  if (glued) {
    const g = glued.toLowerCase();
    if (KNOWN_UNITS.has(g) || g in UNIT_ALIASES || (g.length <= 3 && remainder)) {
      unit = normalizeUnit(g);
    } else {
      remainder = `${glued} ${remainder}`.trim();
    }
  } else {
    const [first, ...others] = remainder.split(/\s+/);
    const f = (first ?? '').toLowerCase();
    if (others.length && (KNOWN_UNITS.has(f) || f in UNIT_ALIASES)) {
      unit = normalizeUnit(f);
      remainder = others.join(' ');
    }
  }
  if (!remainder) return null;
  const { item, note } = splitItemAndNote(remainder, known);
  if (!item) return null;
  return { quantity, ...(unit ? { unit } : {}), item, ...(note ? { note } : {}) };
}

// ----------------------------------------------------------------------------
// Formatting — pure, exported for tests
// ----------------------------------------------------------------------------

/** Compact quantity text: 2.5 kg, 60×, 3 l. Mirrors the kiosk. */
export function fmtQty(quantity: number, unit: string): string {
  const n = Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toFixed(2).replace(/\.?0+$/, '');
  return unit === 'one' || unit === '' ? `${n}×` : `${n} ${unit}`;
}

export type ShelfStatus = 'empty' | 'low' | 'ok';

/** Same rule as the kiosk shelf: empty at 0, low under the floor or a quarter of the target. */
export function shelfStatus(
  onhand: number,
  spec: { target?: number; min?: number }
): ShelfStatus {
  const target = spec.target ?? 0;
  const min = spec.min ?? 0;
  if (onhand <= 0) return 'empty';
  if ((min > 0 && onhand < min) || (target > 0 && onhand < target / 4))
    return 'low';
  return 'ok';
}

const STATUS_ICON: Record<ShelfStatus, string> = {
  empty: '🔴',
  low: '🟡',
  ok: '🟢',
};

const CATEGORY_ICON: Record<string, string> = {
  food: '🥫',
  general: '📦',
  hardware: '🔩',
  tools: '🔧',
  cleaning: '🧼',
  garden: '🌱',
  medical: '💊',
  office: '📎',
};

const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// ----------------------------------------------------------------------------
// The board: everything the commands show, from raw reads
// ----------------------------------------------------------------------------

interface PartnerStock {
  id: string;
  name: string;
  specs: StockItemSpecRecord[];
  events: StockEventLike[];
  federated: string[];
}

export interface StockBoard {
  levels: StockLevel[];
  scarcity: ScarcityEntry[];
  reorder: ReorderLine[];
  positions: StockPosition[];
  plan: StockTransfer[];
}

/**
 * Same arrangement as the kiosk's board: our levels net out our open needs;
 * a partner's surplus is what sits above its keep-back floor (their needs
 * are not federated, so we do not know their demand).
 */
export function buildBoard(input: {
  holonId: string;
  specs: StockItemSpecRecord[];
  events: StockEventLike[];
  needs: unknown[];
  federated: string[];
  partners: PartnerStock[];
}): StockBoard {
  const demands = demandsOf(
    (input.needs ?? []) as Parameters<typeof demandsOf>[0],
    input.holonId
  );
  const levels = reserve(foldStock(input.events, input.holonId), demands);
  const all: StockPosition[] = [...positions(levels, demands, input.specs)];
  const graph: PartnerGraph = { [input.holonId]: input.federated };
  for (const p of input.partners ?? []) {
    all.push(...positions(foldStock(p.events, p.id), [], p.specs));
    graph[p.id] = p.federated;
  }
  return {
    levels,
    scarcity: scarcity(levels, demands, input.specs),
    reorder: reorderList(levels, input.specs),
    positions: all,
    plan: rebalancePlan(all, federationCost(graph)),
  };
}

// ----------------------------------------------------------------------------
// The feature
// ----------------------------------------------------------------------------

class Stock {
  bot: BotLike;
  db: DB;
  settings: Settings;
  eventStore: REAEventStore;

  constructor(bot: BotLike, db: DB, settings: Settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    // Bot's DB.get requires the id arg; core's store type treats it as
    // optional — cast at the boundary like Library does.
    this.eventStore = new REAEventStore(db as any);

    this.bot.command(['stock', 'inventory', 'scorte', 'existencias'], ctx =>
      this.handle(ctx as AnyCtx)
    );
    this.bot.action('stock_reorder_buy', ctx =>
      this.reorderBuyAction(ctx as AnyCtx)
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private holonOf(ctx: AnyCtx): string {
    return String(ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id ?? '');
  }

  private t(key: string, lng: string, vars: Record<string, unknown> = {}) {
    return utils.i18next.t(key, { ...vars, lng });
  }

  private actorOf(ctx: AnyCtx) {
    const from = ctx.from;
    return {
      id: from?.id ?? 0,
      ...(from?.username ? { username: from.username } : {}),
      ...(from?.first_name ? { first_name: from.first_name } : {}),
    };
  }

  private async readSpecs(holonId: string): Promise<StockItemSpecRecord[]> {
    const raw = ((await this.db.getAll(holonId, STOCK_LENS)) ?? []) as unknown[];
    // Only our own records: a federated copy carries `_federation.origin`.
    return readStockItemSpecs(
      raw.filter(
        r => !(r as { _federation?: { origin?: unknown } })?._federation?.origin
      )
    );
  }

  private async readLevels(
    holonId: string
  ): Promise<{ levels: StockLevel[]; events: StockEventLike[] }> {
    const events = ((await this.eventStore.getAll(holonId)) ??
      []) as unknown as StockEventLike[];
    return { levels: foldStock(events, holonId), events };
  }

  private async readNeeds(holonId: string): Promise<unknown[]> {
    try {
      const quests = (await this.db.getAll(holonId, 'quests')) ?? [];
      return quests.filter(q => q && q.type === 'need' && !q._deleted);
    } catch {
      return [];
    }
  }

  private findSpec(
    specs: StockItemSpecRecord[],
    name: string
  ): StockItemSpecRecord | undefined {
    const id = stockItemId(name);
    const lower = name.trim().toLowerCase();
    return specs.find(
      s => s.id === id || s.name.trim().toLowerCase() === lower
    );
  }

  private levelOf(levels: StockLevel[], itemId: string): number {
    return levels.find(l => l.itemId === itemId)?.onhand ?? 0;
  }

  private itemNames(specs: StockItemSpecRecord[]): string {
    return specs.map(s => s.name).join(', ');
  }

  private async record(
    holonId: string,
    ctx: AnyCtx,
    kind: 'stock:produced' | 'stock:consumed' | 'stock:raised' | 'stock:lowered',
    spec: StockItemSpecRecord,
    quantity: number,
    note?: string
  ) {
    const event = buildStockEvent({
      holonId,
      kind,
      itemId: spec.id,
      quantity,
      unit: spec.unit,
      actor: this.actorOf(ctx),
      ...(note ? { note } : {}),
    });
    await this.eventStore.put(holonId, event as any);
  }

  // ── dispatch ─────────────────────────────────────────────────────────────

  async handle(ctx: AnyCtx) {
    const holonId = this.holonOf(ctx);
    const language = await this.settings.getLanguage(holonId);
    const parsed = parseStockCommand(ctx.message?.text ?? '');
    try {
      switch (parsed.sub) {
        case 'shelf':
          return await this.showShelf(ctx, holonId, language);
        case 'add':
          return await this.add(ctx, holonId, language, parsed.rest);
        case 'use':
          return await this.use(ctx, holonId, language, parsed.rest);
        case 'count':
          return await this.count(ctx, holonId, language, parsed.rest);
        case 'target':
          return await this.setSpecLevel(ctx, holonId, language, parsed.rest, 'target');
        case 'keep':
          return await this.setSpecLevel(ctx, holonId, language, parsed.rest, 'min');
        case 'reorder':
          return await this.reorder(ctx, holonId, language, parsed.flag === 'buy');
        case 'moves':
          return await this.moves(ctx, holonId, language);
        case 'help':
        default:
          return await ctx.reply(this.t('stockusage', language));
      }
    } catch (error) {
      console.error('[Stock] command failed:', error);
      return ctx.reply(this.t('stockfailed', language)).catch(() => {});
    }
  }

  // ── /stock ───────────────────────────────────────────────────────────────

  async showShelf(ctx: AnyCtx, holonId: string, language: string) {
    const specs = await this.readSpecs(holonId);
    if (specs.length === 0) {
      return ctx.reply(this.t('stockempty', language));
    }
    const { levels } = await this.readLevels(holonId);
    const byItem = new Map(levels.map(l => [l.itemId, l]));

    const groups = new Map<string, StockItemSpecRecord[]>();
    for (const spec of specs) {
      if (!groups.has(spec.category)) groups.set(spec.category, []);
      groups.get(spec.category)!.push(spec);
    }

    const lines: string[] = [`<b>${this.t('stocktitle', language)}</b>`];
    for (const [category, rows] of groups) {
      const icon = CATEGORY_ICON[category.toLowerCase()] ?? '📦';
      lines.push('', `${icon} <b>${escapeHtml(category)}</b>`);
      for (const spec of rows) {
        const level = byItem.get(spec.id);
        const onhand = level?.onhand ?? 0;
        const status = shelfStatus(onhand, spec);
        const extras: string[] = [];
        if (spec.target)
          extras.push(
            this.t('stocktargetline', language, {
              qty: fmtQty(spec.target, spec.unit),
            })
          );
        if (spec.min)
          extras.push(
            this.t('stockkeepline', language, {
              qty: fmtQty(spec.min, spec.unit),
            })
          );
        if (level?.incoming)
          extras.push(
            this.t('stockincoming', language, {
              qty: fmtQty(level.incoming, spec.unit),
            })
          );
        if (level?.reserved)
          extras.push(
            this.t('stockreserved', language, {
              qty: fmtQty(level.reserved, spec.unit),
            })
          );
        const tail = extras.length ? ` · ${extras.join(' · ')}` : '';
        lines.push(
          `${STATUS_ICON[status]} ${escapeHtml(spec.name)}: <b>${fmtQty(onhand, spec.unit)}</b> ${this.t(`stockstatus${status}`, language)}${escapeHtml(tail)}`
        );
      }
    }
    lines.push('', `<i>${escapeHtml(this.t('stockhint', language))}</i>`);
    return ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  }

  // ── /stock add ───────────────────────────────────────────────────────────

  async add(ctx: AnyCtx, holonId: string, language: string, rest: string) {
    const specs = await this.readSpecs(holonId);
    const parsed = parseQuantityLine(rest, specs.map(s => s.name));
    if (!parsed || parsed.quantity <= 0) {
      return ctx.reply(this.t('stockqtyinvalid', language, { example: 'add 5kg flour' }));
    }
    let spec = this.findSpec(specs, parsed.item);
    let created = false;
    if (!spec) {
      spec = createStockItemSpec({
        name: parsed.item,
        ...(parsed.unit ? { unit: parsed.unit } : {}),
        createdBy: ctx.from?.id,
      });
      await this.db.put(holonId, STOCK_LENS, spec);
      created = true;
    }
    await this.record(holonId, ctx, 'stock:produced', spec, parsed.quantity, parsed.note);
    const { levels } = await this.readLevels(holonId);
    const now = this.levelOf(levels, spec.id);
    const parts = [
      this.t('stockadded', language, {
        qty: fmtQty(parsed.quantity, spec.unit),
        name: spec.name,
        level: fmtQty(now, spec.unit),
      }),
    ];
    if (created) {
      parts.push(
        this.t('stocknewitem', language, {
          name: spec.name,
          unit: spec.unit,
          category: spec.category,
        })
      );
    }
    return ctx.reply(parts.join('\n'));
  }

  // ── /stock use ───────────────────────────────────────────────────────────

  async use(ctx: AnyCtx, holonId: string, language: string, rest: string) {
    const specs = await this.readSpecs(holonId);
    const parsed = parseQuantityLine(rest, specs.map(s => s.name));
    if (!parsed || parsed.quantity <= 0) {
      return ctx.reply(this.t('stockqtyinvalid', language, { example: 'use 2kg flour' }));
    }
    const spec = this.findSpec(specs, parsed.item);
    if (!spec) return this.replyUnknown(ctx, language, parsed.item, specs);
    await this.record(holonId, ctx, 'stock:consumed', spec, parsed.quantity, parsed.note);
    const { levels } = await this.readLevels(holonId);
    const now = this.levelOf(levels, spec.id);
    const parts = [
      this.t('stockused', language, {
        qty: fmtQty(parsed.quantity, spec.unit),
        name: spec.name,
        level: fmtQty(now, spec.unit),
      }),
    ];
    if (now < 0) parts.push(this.t('stockbelowzero', language));
    return ctx.reply(parts.join('\n'));
  }

  // ── /stock count ─────────────────────────────────────────────────────────

  async count(ctx: AnyCtx, holonId: string, language: string, rest: string) {
    const specs = await this.readSpecs(holonId);
    const parsed = parseQuantityLine(rest, specs.map(s => s.name));
    if (!parsed) {
      return ctx.reply(this.t('stockqtyinvalid', language, { example: 'count 12 flour' }));
    }
    const spec = this.findSpec(specs, parsed.item);
    if (!spec) return this.replyUnknown(ctx, language, parsed.item, specs);
    const { levels } = await this.readLevels(holonId);
    const before = this.levelOf(levels, spec.id);
    const delta = parsed.quantity - before;
    if (Math.abs(delta) < 1e-9) {
      return ctx.reply(
        this.t('stockcountsame', language, {
          name: spec.name,
          level: fmtQty(before, spec.unit),
        })
      );
    }
    await this.record(
      holonId,
      ctx,
      correctionKind(delta),
      spec,
      Math.abs(delta),
      parsed.note
    );
    return ctx.reply(
      this.t('stockcounted', language, {
        name: spec.name,
        before: fmtQty(before, spec.unit),
        after: fmtQty(parsed.quantity, spec.unit),
      })
    );
  }

  // ── /stock target · /stock keep ──────────────────────────────────────────

  async setSpecLevel(
    ctx: AnyCtx,
    holonId: string,
    language: string,
    rest: string,
    field: 'target' | 'min'
  ) {
    const specs = await this.readSpecs(holonId);
    const parsed = parseQuantityLine(rest, specs.map(s => s.name));
    if (!parsed) {
      return ctx.reply(
        this.t('stockqtyinvalid', language, {
          example: field === 'target' ? 'target 10kg flour' : 'keep 2kg flour',
        })
      );
    }
    const spec = this.findSpec(specs, parsed.item);
    if (!spec) return this.replyUnknown(ctx, language, parsed.item, specs);
    const value = parsed.quantity > 0 ? parsed.quantity : null;
    const next = updateStockItemSpec(spec, { [field]: value });
    await this.db.put(holonId, STOCK_LENS, next);
    const key =
      field === 'target'
        ? value === null
          ? 'stocktargetcleared'
          : 'stocktargetset'
        : value === null
          ? 'stockkeepcleared'
          : 'stockkeepset';
    return ctx.reply(
      this.t(key, language, {
        name: spec.name,
        qty: fmtQty(parsed.quantity, spec.unit),
      })
    );
  }

  private replyUnknown(
    ctx: AnyCtx,
    language: string,
    name: string,
    specs: StockItemSpecRecord[]
  ) {
    return ctx.reply(
      specs.length
        ? this.t('stockunknown', language, { name, items: this.itemNames(specs) })
        : this.t('stockunknownempty', language, { name })
    );
  }

  // ── /stock reorder ───────────────────────────────────────────────────────

  private async reorderLines(holonId: string): Promise<{
    lines: ReorderLine[];
    hasTargets: boolean;
  }> {
    const specs = await this.readSpecs(holonId);
    const { levels } = await this.readLevels(holonId);
    const needs = await this.readNeeds(holonId);
    const demands = demandsOf(needs as Parameters<typeof demandsOf>[0], holonId);
    return {
      lines: reorderList(reserve(levels, demands), specs),
      hasTargets: specs.some(s => (s.target ?? 0) > 0),
    };
  }

  async reorder(ctx: AnyCtx, holonId: string, language: string, buy: boolean) {
    const { lines, hasTargets } = await this.reorderLines(holonId);
    if (lines.length === 0) {
      return ctx.reply(
        this.t(hasTargets ? 'stockreorderempty' : 'stockreordernotargets', language)
      );
    }
    if (buy) return this.writeShopping(ctx, holonId, language, lines);

    const out: string[] = [`<b>${this.t('stockreordertitle', language)}</b>`, ''];
    for (const line of lines) {
      out.push(
        `• <b>${fmtQty(line.quantity, line.unit)}</b> ${escapeHtml(line.name)} <i>(${escapeHtml(
          this.t('stockreorderbasis', language, {
            target: fmtQty(line.basis.target, line.unit),
            onhand: fmtQty(line.basis.onhand, line.unit),
          })
        )})</i>`
      );
    }
    out.push('', `<i>${escapeHtml(this.t('stockreorderhint', language))}</i>`);
    return ctx.reply(out.join('\n'), {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            this.t('stocktoshopping', language),
            'stock_reorder_buy'
          ),
        ],
      ]),
    });
  }

  private async writeShopping(
    ctx: AnyCtx,
    holonId: string,
    language: string,
    lines: ReorderLine[]
  ) {
    const changed = await syncReorderToShopping(this.db as any, holonId, lines, {
      creator: ctx.from?.id,
    });
    return ctx.reply(
      changed
        ? this.t('stockshoppingupdated', language, { n: changed })
        : this.t('stockshoppingsame', language)
    );
  }

  async reorderBuyAction(ctx: AnyCtx) {
    await ctx.answerCbQuery?.().catch(() => {});
    const holonId = this.holonOf(ctx);
    const language = await this.settings.getLanguage(holonId);
    try {
      const { lines, hasTargets } = await this.reorderLines(holonId);
      if (lines.length === 0) {
        return ctx.reply(
          this.t(hasTargets ? 'stockreorderempty' : 'stockreordernotargets', language)
        );
      }
      return await this.writeShopping(ctx, holonId, language, lines);
    } catch (error) {
      console.error('[Stock] reorder buy failed:', error);
      return ctx.reply(this.t('stockshoppingfailed', language)).catch(() => {});
    }
  }

  // ── /stock moves ─────────────────────────────────────────────────────────

  private async readPartners(
    holonId: string
  ): Promise<{ federated: string[]; names: Record<string, string>; partners: PartnerStock[] }> {
    let federated: string[] = [];
    let names: Record<string, string> = {};
    try {
      const snapshot = await getFederationSnapshot(this.db as any, holonId);
      federated = (snapshot.federated ?? []).filter(id => id && id !== holonId);
      names = snapshot.partnerNames ?? {};
    } catch (error) {
      console.warn('[Stock] federation snapshot failed:', error);
    }
    const partners = await Promise.all(
      federated.map(async (id): Promise<PartnerStock> => {
        let events: StockEventLike[] = [];
        let specs: StockItemSpecRecord[] = [];
        let fed: string[] = [holonId];
        try {
          events = ((await this.db.getAll(id, 'rea_events')) ?? []) as StockEventLike[];
        } catch (error) {
          console.warn('[Stock] partner events failed:', id, error);
        }
        try {
          specs = readStockItemSpecs(((await this.db.getAll(id, STOCK_LENS)) ?? []) as unknown[]);
        } catch (error) {
          console.warn('[Stock] partner specs failed:', id, error);
        }
        try {
          fed = (await getFederationSnapshot(this.db as any, id)).federated ?? [holonId];
        } catch {
          fed = [holonId];
        }
        return { id, name: names[id] ?? '', specs, events, federated: fed };
      })
    );
    return { federated, names, partners };
  }

  async moves(ctx: AnyCtx, holonId: string, language: string) {
    const specs = await this.readSpecs(holonId);
    const { events } = await this.readLevels(holonId);
    const needs = await this.readNeeds(holonId);
    const { federated, names, partners } = await this.readPartners(holonId);
    const board = buildBoard({ holonId, specs, events, needs, federated, partners });

    const here = this.t('stockhere', language);
    const nameOf = (id: string) =>
      id === holonId ? here : names[id] || partners.find(p => p.id === id)?.name || id;
    const cost = federationCost(
      Object.fromEntries([
        [holonId, federated],
        ...partners.map(p => [p.id, p.federated] as [string, string[]]),
      ])
    );

    const out: string[] = [];
    const short = board.scarcity.filter(s => s.shortage > 0);
    out.push(`<b>${this.t('stockshortages', language)}</b>`);
    if (short.length === 0) {
      out.push(this.t('stocknoshortage', language));
    } else {
      for (const s of short) {
        out.push(
          `• ${escapeHtml(s.category)}: <b>${fmtQty(s.shortage, '')}</b> ${escapeHtml(
            this.t('stockshortline', language, {
              pct: Math.round(s.blocked * 100),
              demand: fmtQty(s.demand, ''),
              available: fmtQty(s.available, ''),
            })
          )}`
        );
      }
    }

    out.push('', `<b>${this.t('stockplan', language)}</b>`);
    if (federated.length === 0) {
      out.push(this.t('stocknopartners', language));
    } else if (board.plan.length === 0) {
      out.push(this.t('stockplanempty', language));
    } else {
      for (const leg of board.plan) {
        const hops = cost(leg.from, leg.to);
        out.push(
          `• ${escapeHtml(leg.category)}: <b>${fmtQty(leg.quantity, '')}</b> ${escapeHtml(nameOf(leg.from))} → ${escapeHtml(nameOf(leg.to))} <i>(${escapeHtml(
            hops === 1
              ? this.t('stockhop1', language)
              : this.t('stockhopsn', language, { n: Number.isFinite(hops) ? hops : '?' })
          )})</i>`
        );
      }
    }

    const spare = board.positions.filter(p => p.surplus > 0);
    if (spare.length) {
      out.push('', `<b>${this.t('stockpositions', language)}</b>`);
      for (const p of spare) {
        out.push(
          `• ${escapeHtml(nameOf(p.holonId))} · ${escapeHtml(p.category)}: ${escapeHtml(
            this.t('stocksurplus', language, { qty: fmtQty(p.surplus, '') })
          )}`
        );
      }
    }
    return ctx.reply(out.join('\n'), { parse_mode: 'HTML' });
  }
}

export default Stock;
