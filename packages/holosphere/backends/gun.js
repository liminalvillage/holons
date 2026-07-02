/**
 * GunBackend — StorageBackend implementation wrapping GUN.
 *
 * Extracted from the inline Gun operations previously spread across
 * content.js, global.js, and utils.js.  The public API matches the
 * StorageBackend interface defined in interface.d.ts.
 */

import Gun from 'gun';

const DEFAULT_READ_TIMEOUT = 8000;
const DEFAULT_WRITE_TIMEOUT = 5000;

export class GunBackend {
  constructor(appname, gunOptions = {}) {
    this.type = 'gun';
    this.appname = appname;

    const defaults = {
      peers: ['https://gun.holons.io/gun'],
      axe: false,
      radisk: true,
      file: './holosphere',
    };
    if (typeof window !== 'undefined' && gunOptions.radisk !== false) {
      defaults.localStorage = false;
    }
    const finalOptions = { ...defaults, ...gunOptions };
    this.gun = Gun(finalOptions);
  }

  _path(holon, lens) {
    const base = this.gun.get(this.appname);
    if (holon === null || holon === undefined || holon === '') {
      return base.get(lens);
    }
    return base.get(holon).get(lens);
  }

  async put(holon, lens, key, payload, options = {}) {
    const timeout = options.timeout ?? DEFAULT_WRITE_TIMEOUT;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };

      this._path(holon, lens).get(key).put(payload, (ack) => {
        finish({ ok: !ack.err, queued: false });
      });

      if (timeout > 0) {
        setTimeout(() => finish({ ok: true, queued: true }), timeout);
      }
    });
  }

  async get(holon, lens, key, options = {}) {
    const timeout = options.timeout ?? DEFAULT_READ_TIMEOUT;
    const awaitNetwork = options.awaitNetwork || false;

    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v ?? null); } };

      const node = this._path(holon, lens).get(key);

      if (!awaitNetwork) {
        node.once((data) => finish(data));
      } else {
        const detach = () => { try { if (node.off) node.off(); } catch { /* ignore */ } };
        const finishNet = (v) => { if (!done) { done = true; detach(); resolve(v ?? null); } };
        node.on((data) => {
          if (data === undefined) return;
          finishNet(data);
        });
        if (timeout > 0) setTimeout(() => finishNet(null), timeout);
        return;
      }

      if (timeout > 0) setTimeout(() => finish(null), timeout);
    });
  }

  async getAll(holon, lens, options = {}) {
    const timeout = options.timeout ?? DEFAULT_READ_TIMEOUT;
    const path = this._path(holon, lens);

    const shallowOnce = () => new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      path.once((data) => finish(data));
      if (timeout > 0) setTimeout(() => finish(null), timeout);
    });

    let data = await shallowOnce();
    if (!data) {
      await new Promise(r => setTimeout(r, 1500));
      data = await shallowOnce();
    }

    if (!data) return new Map();

    const result = new Map();
    const keys = Object.keys(data).filter(k => {
      if (k === '_') return false;
      const val = data[k];
      if (val === null) return false;
      if (typeof val === 'object' && val['#']) return false;
      return true;
    });

    if (keys.length === 0) return result;

    const onceWithTimeout = (node) => new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v ?? null); } };
      node.once((d) => finish(d));
      if (timeout > 0) setTimeout(() => finish(null), timeout);
    });

    await Promise.all(keys.map(async (key) => {
      const inline = data[key];
      let value;
      if (typeof inline !== 'object' || inline === null) {
        value = inline;
      } else {
        value = await onceWithTimeout(path.get(key));
      }
      if (value !== null && value !== undefined) {
        result.set(key, value);
      }
    }));

    return result;
  }

  async delete(holon, lens, key) {
    return new Promise((resolve) => {
      this._path(holon, lens).get(key).put(null, (ack) => {
        resolve(!ack.err);
      });
    });
  }

  subscribe(holon, lens, callback, options = {}) {
    const path = this._path(holon, lens);
    const mapChain = path.map();

    mapChain.on((data, key) => {
      if (key === '_') return;
      callback(key, data ?? null);
    });

    return {
      unsubscribe: () => {
        try { path.off(); } catch { /* ignore */ }
      }
    };
  }

  getNodeRef(soul) {
    const parts = soul.split('/').filter(Boolean);
    let ref = this.gun.get(this.appname);
    for (const part of parts) {
      ref = ref.get(part);
    }
    return ref;
  }

  async ready() {
    // Gun connects eagerly — nothing to await
  }

  async close() {
    try {
      if (this.gun && this.gun.back) {
        const mesh = this.gun.back('opt.mesh');
        if (mesh) {
          const peers = mesh.say?.peers || mesh.peers || {};
          for (const peer of Object.values(peers)) {
            if (peer?.wire?.close) peer.wire.close();
          }
        }
        if (this.gun.back('opt.web')) {
          const server = this.gun.back('opt.web');
          if (server?.close) await new Promise(r => server.close(r));
        }
      }
      if (this.gun?.off) this.gun.off();
    } catch { /* best-effort cleanup */ }
  }
}
