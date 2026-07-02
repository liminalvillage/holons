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
import { getModelOrGeneric, getRegistryModel, loadSubjectClasses } from '../subjects/index.js';

export class AD4MBackend {
  constructor(appname, ad4mOptions = {}) {
    this.type = 'ad4m';
    this.appname = appname;
    this.client = null;
    this.perspectives = new Map();
    this.registryPerspective = null;
    this._url = ad4mOptions.url ?? 'ws://localhost:12000/graphql';
    this._token = ad4mOptions.token;
    this._schemas = ad4mOptions.schemas ?? null;
    this._schemaDir = ad4mOptions.schemaDir ?? null;
  }

  async ready() {
    this.client = new Ad4mClient(this._url);
    if (this._token) {
      await this.client.agent.authenticate(this._token);
    }

    loadSubjectClasses(this._schemaDir, this._schemas);
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

  async _perspectiveFor(holon) {
    if (!holon) return this.registryPerspective;
    if (this.perspectives.has(holon)) return this.perspectives.get(holon);

    const all = await this.client.perspective.all();
    const match = all.find(p => p.name === `${this.appname}:${holon}`);
    if (match) {
      this.perspectives.set(holon, match);
      return match;
    }

    const p = await this.client.perspective.add(`${this.appname}:${holon}`);
    this.perspectives.set(holon, p);

    try {
      const RegistryModel = getRegistryModel();
      const entryUri = `holons://registry/${holon}`;
      await this.registryPerspective.createSubject(RegistryModel, entryUri, {
        holonId: holon,
        perspectiveUuid: p.uuid,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[AD4MBackend] Failed to register perspective for holon "${holon}":`, err.message);
    }

    return p;
  }

  _itemUri(holon, lens, key) {
    return `holons://${this.appname}/${holon ?? '_global'}/${lens}/${key}`;
  }

  async put(holon, lens, key, payload, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const Model = getModelOrGeneric(lens);
    const baseUri = this._itemUri(holon, lens, key);
    const data = JSON.parse(payload);

    try {
      const existing = await perspective.getSubjectData(Model, baseUri);
      if (existing) {
        await Model.update(perspective, baseUri, data);
        return { ok: true };
      }
    } catch {
      // Does not exist yet — create
    }

    try {
      await perspective.createSubject(Model, baseUri, data);
      return { ok: true };
    } catch (err) {
      console.error(`[AD4MBackend] put failed for ${baseUri}:`, err.message);
      return { ok: false };
    }
  }

  async get(holon, lens, key, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const Model = getModelOrGeneric(lens);
    const baseUri = this._itemUri(holon, lens, key);

    try {
      const data = await perspective.getSubjectData(Model, baseUri);
      return data ? JSON.stringify(data) : null;
    } catch {
      return null;
    }
  }

  async getAll(holon, lens, options = {}) {
    const perspective = await this._perspectiveFor(holon);
    const Model = getModelOrGeneric(lens);
    const result = new Map();

    try {
      const instances = await Model.findAll(perspective);
      for (const inst of instances) {
        const id = inst.baseExpression || inst.id;
        if (id) {
          const data = await perspective.getSubjectData(Model, inst.baseExpression || id);
          result.set(String(data.id || id), JSON.stringify(data));
        }
      }
    } catch {
      // Empty lens or model not registered
    }

    return result;
  }

  async delete(holon, lens, key) {
    const perspective = await this._perspectiveFor(holon);
    const Model = getModelOrGeneric(lens);
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

    const Model = getModelOrGeneric(lens);
    const perspectivePromise = this._perspectiveFor(holon);

    perspectivePromise.then(async (perspective) => {
      if (cancelled) return;

      queryBuilder = Model.query(perspective);
      const initial = await queryBuilder.subscribe((instances) => {
        if (cancelled) return;
        this._diffAndEmit(perspective, Model, instances, prev, callback, options);
      });

      // Emit initial results
      if (!cancelled && initial?.length > 0) {
        const current = new Map();
        for (const inst of initial) {
          try {
            const id = inst.baseExpression || inst.id;
            if (!id) continue;
            const data = await perspective.getSubjectData(Model, inst.baseExpression || id);
            const key = String(data.id || id);
            const json = JSON.stringify(data);
            current.set(key, json);
            callback(key, json);
          } catch { /* skip unreadable instance */ }
        }
        prev = current;
      }
    }).catch((err) => {
      console.error(`[AD4MBackend] subscribe setup failed for ${holon}/${lens}:`, err.message);
    });

    return {
      unsubscribe: () => {
        cancelled = true;
        if (queryBuilder?.dispose) queryBuilder.dispose();
      }
    };
  }

  async _diffAndEmit(perspective, Model, instances, prev, callback, options) {
    const current = new Map();
    for (const inst of instances) {
      try {
        const id = inst.baseExpression || inst.id;
        if (!id) continue;
        const data = await perspective.getSubjectData(Model, inst.baseExpression || id);
        const key = String(data.id || id);
        const json = JSON.stringify(data);
        current.set(key, json);

        if (prev.get(key) !== json) {
          callback(key, json);
        }
      } catch { /* skip */ }
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
