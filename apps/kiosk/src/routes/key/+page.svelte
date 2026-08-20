<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Telegram Mini App: the user's signing-key vault.
  //
  // Runs INSIDE Telegram (registered in BotFather; deep-linked from the
  // kiosk's pairing QR). The Nostr key is generated here, client-side, and
  // stored in the user's Telegram CloudStorage — per-user, per-bot, readable
  // from any device where they hold the Telegram account. No server of ours
  // ever sees it: there is nothing to derive it from and nowhere to leak it
  // from. When opened with a pairing start_param, the key is sealed
  // end-to-end to the kiosk's ephemeral pubkey (pairing.ts) and dropped on
  // the public channel as ciphertext.
  import { onMount } from "svelte";
  import { nostrUtils } from "holosphere";
  import { t } from "$lib/i18n";
  import { getHolosphere } from "$lib/holosphere";
  import { PAIRING_LENS, parseStartParam, sealKey } from "$lib/pairing";

  const SK_ITEM = "nostr_sk";

  type Tg = {
    initData: string;
    initDataUnsafe: {
      user?: { id: number | string };
      start_param?: string;
    };
    version: string;
    isVersionAtLeast?: (v: string) => boolean;
    ready: () => void;
    expand?: () => void;
    close?: () => void;
    CloudStorage?: {
      getItem: (
        key: string,
        cb: (err: unknown, value?: string | null) => void,
      ) => void;
      setItem: (
        key: string,
        value: string,
        cb: (err: unknown, ok?: boolean) => void,
      ) => void;
    };
  };

  let state:
    | "loading"
    | "outside" // not inside Telegram
    | "unsupported" // Telegram too old for CloudStorage
    | "ready" // key present, no pairing requested
    | "sending"
    | "sent"
    | "error" = "loading";
  let pubShort = "";
  let revealed: string | null = null;
  let tg: Tg | null = null;

  const cloudGet = (cs: NonNullable<Tg["CloudStorage"]>, key: string) =>
    new Promise<string | null>((resolve, reject) =>
      cs.getItem(key, (err, v) => (err ? reject(err) : resolve(v ?? null))),
    );
  const cloudSet = (
    cs: NonNullable<Tg["CloudStorage"]>,
    key: string,
    value: string,
  ) =>
    new Promise<void>((resolve, reject) =>
      cs.setItem(key, value, (err) => (err ? reject(err) : resolve())),
    );

  function loadTelegramScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).Telegram?.WebApp) return resolve();
      const s = document.createElement("script");
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("telegram script failed"));
      document.head.appendChild(s);
    });
  }

  async function run() {
    await loadTelegramScript();
    tg = ((window as any).Telegram?.WebApp as Tg) ?? null;
    // No initData → opened in a plain browser, not from Telegram.
    if (!tg?.initData) {
      state = "outside";
      return;
    }
    tg.ready();
    tg.expand?.();
    const cs = tg.CloudStorage;
    if (!cs || (tg.isVersionAtLeast && !tg.isVersionAtLeast("6.9"))) {
      state = "unsupported";
      return;
    }

    // The key: fetch from the user's Telegram cloud, or mint it now.
    let sk = await cloudGet(cs, SK_ITEM);
    if (!sk || !/^[0-9a-f]{64}$/i.test(sk)) {
      sk = nostrUtils.generatePrivateKey();
      await cloudSet(cs, SK_ITEM, sk);
    }
    const pub = nostrUtils.getPublicKey(sk);
    pubShort = `${pub.slice(0, 8)}…${pub.slice(-8)}`;

    // Pairing requested? Seal the key to the kiosk and drop the envelope.
    const pairing = parseStartParam(tg.initDataUnsafe.start_param);
    if (!pairing) {
      state = "ready";
      return;
    }
    state = "sending";
    const envelope = await sealKey(
      sk,
      pairing.kioskPub,
      pairing.channelId,
      tg.initDataUnsafe.user ? String(tg.initDataUnsafe.user.id) : undefined,
    );
    const hs = await getHolosphere();
    await hs.putGlobal(PAIRING_LENS, envelope);
    state = "sent";
  }

  function reveal() {
    if (!tg?.CloudStorage) return;
    if (revealed) {
      revealed = null;
      return;
    }
    cloudGet(tg.CloudStorage, SK_ITEM).then((sk) => (revealed = sk ?? null));
  }

  onMount(() => {
    run().catch((err) => {
      console.error("[key] vault error", err);
      state = "error";
    });
  });
</script>

<svelte:head>
  <title>Holons key</title>
</svelte:head>

<div class="vault">
  <h1>🔑 {$t("key.title")}</h1>

  {#if state === "loading"}
    <p>{$t("key.loading")}</p>
  {:else if state === "outside"}
    <p>{$t("key.outside")}</p>
  {:else if state === "unsupported"}
    <p>{$t("key.unsupported")}</p>
  {:else if state === "error"}
    <p class="err">{$t("key.error")}</p>
  {:else}
    <p class="pub">
      {$t("key.identity")}
      <code>{pubShort}</code>
    </p>
    {#if state === "sending"}
      <p class="pulse">{$t("key.sending")}</p>
    {:else if state === "sent"}
      <p class="ok">✓ {$t("key.sent")}</p>
      {#if tg?.close}
        <button class="btn" on:click={() => tg?.close?.()}>
          {$t("key.done")}
        </button>
      {/if}
    {:else}
      <p class="hint">{$t("key.readyHint")}</p>
    {/if}
    <button class="btn ghost" on:click={reveal}>
      {revealed ? $t("key.hideKey") : $t("key.revealKey")}
    </button>
    {#if revealed}
      <p class="hint">{$t("key.backupHint")}</p>
      <code class="secret">{revealed}</code>
    {/if}
  {/if}
</div>

<style>
  .vault {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    padding: 1.2rem;
    text-align: center;
    background: var(--bg, #101418);
    color: var(--ink, #e8e6e0);
    font-family: inherit;
  }
  h1 {
    margin: 0;
    font-size: 1.2rem;
  }
  .pub code {
    display: block;
    margin-top: 0.3rem;
    font-size: 0.85rem;
    opacity: 0.85;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.75;
    max-width: 24rem;
  }
  .secret {
    font-size: 0.72rem;
    word-break: break-all;
    max-width: 24rem;
    padding: 0.5rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.08);
  }
  .pulse {
    animation: fade 1.4s ease-in-out infinite alternate;
    margin: 0;
  }
  @keyframes fade {
    from {
      opacity: 0.35;
    }
    to {
      opacity: 0.9;
    }
  }
  .ok {
    color: #43c59e;
    font-weight: 600;
    margin: 0;
  }
  .err {
    color: #d05353;
  }
  .btn {
    padding: 0.55rem 1.2rem;
    border-radius: 0.6rem;
    border: none;
    background: #43c59e;
    color: #08110d;
    font-weight: 600;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
    color: inherit;
    border: 1px solid rgba(255, 255, 255, 0.25);
  }
</style>
