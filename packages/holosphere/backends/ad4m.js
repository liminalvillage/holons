/**
 * AD4MBackend — StorageBackend implementation using AD4M perspectives
 * and subject classes.
 *
 * Maps holosphere concepts to AD4M:
 *   holon  → Perspective (local) or Neighbourhood (shared via Holochain DHT)
 *   lens   → Subject class (generated from JSON Schema via Ad4mModel.fromJSONSchema)
 *   item   → Subject instance (a set of links conforming to a SHACL class)
 *   key    → Expression URI of the base entity
 */

import { Ad4mClient } from '@coasys/ad4m';
import { getAllModels, getModelForLens, getModelOrGeneric, getRegistryModel, loadSubjectClasses } from '../subjects/index.js';

// AD4M's `fromJSONSchema` gives every *required* property that wasn't supplied
// an explicit value the sentinel `ad4m://undefined` (json-schema.ts). Because a
// subject class forces required props to exist, an omitted one reads back as
// this literal string. We treat it as "unset" on read, so a lens item written
// without (say) a `type` comes back with `type` absent — matching GunBackend's
// "absent when unset" semantics rather than leaking the sentinel to callers.
const AD4M_UNSET = 'ad4m://undefined';

export class AD4MBackend {
  constructor(appname, ad4mOptions = {}) {
    this.type = 'ad4m';
    this.appname = appname;
    this.client = null;
    this.perspectives = new Map();
    // Perspective UUIDs whose subject-class SDNA has already been registered,
    // so we register each perspective's classes exactly once per session.
    this._registered = new Set();
    this.registryPerspective = null;
    this._url = ad4mOptions.url ?? 'http://localhost:12000';
    this._token = ad4mOptions.token;
    this._schemas = ad4mOptions.schemas ?? null;
    this._schemaDir = ad4mOptions.schemaDir ?? null;
  }

  async ready() {
    // Token is a constructor arg on Ad4mClient(baseUrl, token?, subscribe?),
    // threaded into every sub-client's auth. There is no agent.authenticate().
    this.client = new Ad4mClient(this._url, this._token);

    await loadSubjectClasses(this._schemaDir, this._schemas);
    await this._loadRegistry();
  }

  async _loadRegistry() {
    const RegistryModel = getRegistryModel();
    const all = await this.client.perspective.all();
    let reg = all.find(p => p.name === `${this.appname}:registry`);
    if (!reg) {
      reg = await this.client.perspective.add(`${this.appname}:registry`);
    }
    this.registryPerspective = reg;

    // The registry perspective must know the registry subject class before it
    // can create/read holon→perspective entries.
    try {
      await RegistryModel.register(reg);
    } catch (err) {
      console.warn(`[AD4MBackend] Failed to register registry class:`, err.message);
    }

    try {
      const entries = await RegistryModel.findAll(reg);
      for (const entry of entries) {
        if (entry.holonId && entry.perspectiveUuid) {
          const proxy = await this.client.perspective.byUUID(entry.perspectiveUuid);
          if (proxy) this.perspectives.set(entry.holonId, proxy);
        }
      }
    } catch {
      // Registry may be empty on first run
    }
  }

  /**
   * Register every lens subject class onto a holon perspective, once. An AD4M
   * perspective rejects `createSubject`/`getSubjectData` for a class whose SDNA
   * it has not seen, so this must run before the first read or write.
   */
  async _ensureClasses(perspective) {
    if (!perspective || this._registered.has(perspective.uuid)) return;
    try {
      const { Ad4mModel } = await import('@coasys/ad4m');
      await Ad4mModel.registerAll(perspective, getAllModels());
      this._registered.add(perspective.uuid);
    } catch (err) {
      console.warn(`[AD4MBackend] Failed to register lens classes on "${perspective.name}":`, err.message);
    }
  }

  async _perspectiveFor(holon) {
    // The global table (null holon) is a first-class perspective like any other
    // (`${appname}:_global`), NOT the registry perspective — the registry only
    // ever has the registry subject class registered, so storing lens data there
    // would fail ("No SHACL constructor found"). Routing it through the normal
    // path ensures its lens/generic classes are registered too.
    const key = holon ?? '_global';
    if (this.perspectives.has(key)) return this.perspectives.get(key);

    const all = await this.client.perspective.all();
    const match = all.find(p => p.name === `${this.appname}:${key}`);
    if (match) {
      this.perspectives.set(key, match);
      await this._ensureClasses(match);
      return match;
    }

    const p = await this.client.perspective.add(`${this.appname}:${key}`);
    this.perspectives.set(key, p);
    await this._ensureClasses(p);

    try {
      const RegistryModel = getRegistryModel();
      const entryUri = `holons://registry/${key}`;
      await this.registryPerspective.createSubject(RegistryModel, entryUri, {
        holonId: key,
        perspectiveUuid: p.uuid,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[AD4MBackend] Failed to register perspective for holon "${key}":`, err.message);
    }

    return p;
  }

  _itemUri(holon, lens, key) {
    return `holons://${this.appname}/${holon ?? '_global'}/${lens}/${key}`;
  }

  _lensPrefix(holon, lens) {
    return `holons://${this.appname}/${holon ?? '_global'}/${lens}/`;
  }

  /** The holon-local key (logical `id`) encoded in a base expression. */
  _keyFromBase(base) {
    const s = String(base ?? '');
    const seg = s.split('/').pop();
    return seg || s;
  }

  /**
   * Copy a hydrated Ad4mModel instance's own data properties into a plain
   * object, dropping internal (`_`-prefixed) fields and methods. For lenses
   * without a dedicated schema the payload was round-tripped through the
   * generic model's single `data` JSON string, so unwrap it back.
   *
   * AD4M reserves `id` as the base-expression alias, so a schema's own `id`
   * property is never surfaced as a data field — it lives on `_baseExpression`.
   * We restore it from there so callers (and holosphere's `processItem`, which
   * keys every item by `id`) see the logical id they wrote.
   */
  _plain(inst, dedicated) {
    if (!dedicated) {
      try {
        const obj = JSON.parse(inst.data);
        if (obj && obj.id === undefined) obj.id = this._keyFromBase(inst._baseExpression);
        return obj;
      } catch {
        return { id: this._keyFromBase(inst._baseExpression) };
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(inst)) {
      if (k.startsWith('_') || typeof v === 'function') continue;
      if (v === AD4M_UNSET) continue;
      out[k] = v;
    }
    if (out.id === undefined) {
      const key = this._keyFromBase(inst._baseExpression);
      if (key) out.id = key;
    }
    return out;
  }

  /**
   * Shape the write payload for the resolved model. A dedicated lens persists
   * its declared properties directly; a generic lens round-trips the whole
   * payload as a JSON string under `data`. The generic model has no `id`
   * property (see subjects/index.js) — the logical key lives in the base URI
   * and is restored on read by `_plain`, so we don't shape one in here.
   */
  _shape(parsed, key, dedicated) {
    if (dedicated) return parsed;
    return { data: JSON.stringify(parsed) };
  }

  async put(holon, lens, key, payload, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const dedicated = getModelForLens(lens);
    const Model = dedicated ?? getModelOrGeneric(lens);
    const baseUri = this._itemUri(holon, lens, key);
    const data = this._shape(JSON.parse(payload), key, dedicated);

    try {
      const existing = await Model.findOne(perspective, { where: { id: baseUri } });
      if (existing) {
        await Model.update(perspective, baseUri, data);
      } else {
        const inst = new Model(perspective, baseUri);
        Object.assign(inst, data);
        await inst.save();
      }
      return { ok: true };
    } catch (err) {
      console.error(`[AD4MBackend] put failed for ${baseUri}:`, err.message);
      return { ok: false };
    }
  }

  async get(holon, lens, key, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const dedicated = getModelForLens(lens);
    const Model = dedicated ?? getModelOrGeneric(lens);
    const baseUri = this._itemUri(holon, lens, key);

    try {
      const inst = await Model.findOne(perspective, { where: { id: baseUri } });
      return inst ? JSON.stringify(this._plain(inst, dedicated)) : null;
    } catch {
      return null;
    }
  }

  async getAll(holon, lens, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const dedicated = getModelForLens(lens);
    const Model = dedicated ?? getModelOrGeneric(lens);
    const prefix = this._lensPrefix(holon, lens);
    const result = new Map();

    try {
      const instances = await Model.findAll(perspective);
      for (const inst of instances) {
        // A dedicated class is unique per lens, but the generic model backs
        // every schema-less lens on this perspective — scope by URI prefix so
        // one lens never bleeds another's items.
        if (!dedicated && !String(inst._baseExpression ?? '').startsWith(prefix)) {
          continue;
        }
        const plain = this._plain(inst, dedicated);
        const id = String(plain.id ?? '');
        if (id) result.set(id, JSON.stringify(plain));
      }
    } catch {
      // Empty lens or model not registered
    }

    return result;
  }

  async delete(holon, lens, key) {
    const perspective = await this._perspectiveFor(holon);
    const Model = getModelForLens(lens) ?? getModelOrGeneric(lens);
    const baseUri = this._itemUri(holon, lens, key);

    try {
      await Model.delete(perspective, baseUri);
      return true;
    } catch {
      return false;
    }
  }

  subscribe(holon, lens, callback, options = {}) {
    let cancelled = false;
    let queryBuilder = null;
    let prev = new Map();

    // Resolves once the initial subscription baseline is established. AD4M's
    // subscribe setup is async (perspective fetch + query subscription), unlike
    // Gun's synchronous path, so a write issued in the same tick as subscribe()
    // could otherwise race the baseline. Consumers that must not miss an
    // imminent write can `await handle.ready()`; the field is absent on Gun's
    // handle, so callers optional-chain it (`handle.ready?.()`).
    let resolveReady;
    const readyPromise = new Promise((res) => { resolveReady = res; });

    const dedicated = getModelForLens(lens);
    const Model = dedicated ?? getModelOrGeneric(lens);
    const prefix = this._lensPrefix(holon, lens);
    const perspectivePromise = this._perspectiveFor(holon);

    // A hydrated instance → `[key, jsonString]`, or null when it doesn't
    // belong to this lens. Mirrors the getAll read path so subscribers and
    // one-shot reads agree on shape and on the reconstructed `id`.
    const toEntry = (inst) => {
      if (!dedicated && !String(inst._baseExpression ?? '').startsWith(prefix)) return null;
      const plain = this._plain(inst, dedicated);
      const id = String(plain.id ?? '');
      if (!id) return null;
      return [id, JSON.stringify(plain)];
    };

    perspectivePromise.then(async (perspective) => {
      if (cancelled) return;

      queryBuilder = Model.query(perspective);
      // `subscribe(cb)` returns the initial hydrated instances and invokes `cb`
      // with a fresh full array on every later change.
      const initial = await queryBuilder.subscribe((instances) => {
        if (cancelled) return;
        this._diffAndEmit(instances, prev, callback, toEntry, options);
      });
      if (cancelled) return;

      const current = new Map();
      for (const inst of initial ?? []) {
        const entry = toEntry(inst);
        if (!entry) continue;
        current.set(entry[0], entry[1]);
        callback(entry[0], entry[1]);
      }
      prev = current;
      resolveReady();
    }).catch((err) => {
      console.error(`[AD4MBackend] subscribe setup failed for ${holon}/${lens}:`, err.message);
      // Don't leave `ready()` awaiters hanging if setup fails.
      resolveReady();
    });

    return {
      ready: () => readyPromise,
      unsubscribe: () => {
        cancelled = true;
        if (queryBuilder?.dispose) queryBuilder.dispose();
      }
    };
  }

  _diffAndEmit(instances, prev, callback, toEntry, options) {
    const current = new Map();
    for (const inst of instances) {
      const entry = toEntry(inst);
      if (!entry) continue;
      const [key, json] = entry;
      current.set(key, json);
      if (prev.get(key) !== json) callback(key, json);
    }

    if (options.includeDeletes !== false) {
      for (const key of prev.keys()) {
        if (!current.has(key)) callback(key, null);
      }
    }

    prev.clear();
    for (const [k, v] of current) prev.set(k, v);
  }

  getNodeRef(soul) {
    return new AD4MNodeRef(this, soul);
  }

  async getAgentDID() {
    const me = await this.client.agent.me();
    return me.did;
  }

  async close() {
    this.perspectives.clear();
  }
}

/**
 * NodeRef shim for AD4M — provides the same get/put/once interface as Gun
 * nodes for hologram tracking links.  Stores tracking data as links on
 * the registry perspective.
 */
class AD4MNodeRef {
  constructor(backend, soul) {
    this._backend = backend;
    this._soul = soul;
    this._path = [];
  }

  get(path) {
    const child = new AD4MNodeRef(this._backend, this._soul);
    child._path = [...this._path, path];
    return child;
  }

  put(value, callback) {
    const fullPath = [this._soul, ...this._path].join('/');
    this._backend._storeTrackingLink(fullPath, value)
      .then(() => callback?.({ ok: true }))
      .catch((err) => callback?.({ err: err?.message || 'unknown error' }));
  }

  once(callback) {
    const fullPath = [this._soul, ...this._path].join('/');
    this._backend._readTrackingLink(fullPath)
      .then((data) => callback(data))
      .catch(() => callback(null));
  }

  off() {
    // No-op for AD4M node refs
  }
}

// Internal tracking link helpers on AD4MBackend
AD4MBackend.prototype._storeTrackingLink = async function(path, value) {
  if (!this.registryPerspective) return;
  const source = `holons://tracking/${encodeURIComponent(path)}`;
  const target = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  await this.registryPerspective.add({
    source,
    predicate: 'holons://tracking',
    target: `literal://${encodeURIComponent(target)}`,
  });
};

AD4MBackend.prototype._readTrackingLink = async function(path) {
  if (!this.registryPerspective) return null;
  const source = `holons://tracking/${encodeURIComponent(path)}`;
  const links = await this.registryPerspective.get(
    { source, predicate: 'holons://tracking' }
  );
  if (!links?.length) return null;
  const raw = links[links.length - 1].data?.target;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw.replace('literal://', ''));
  try { return JSON.parse(decoded); } catch { return decoded; }
};
