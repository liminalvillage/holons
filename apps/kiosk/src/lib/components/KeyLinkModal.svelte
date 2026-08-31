<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Pair the user's Telegram-held signing key with this kiosk session.
  //
  // Shows a QR deep-link into our Telegram Mini App (routes/key). The Mini App
  // seals the key end-to-end to this pairing's ephemeral pubkey and drops the
  // envelope on the global `key_pairing` lens; we poll for it, decrypt, adopt
  // the identity (hs.login), and delete the envelope. The ephemeral private
  // key and the adopted secret never leave this component's memory.
  import { onDestroy, onMount } from "svelte";
  import QRCode from "qrcode";
  import { get } from "svelte/store";
  import { t } from "$lib/i18n";
  import { currentUser } from "$lib/auth";
  import { getHolosphere } from "$lib/holosphere";
  import { resolveMiniapp } from "$lib/config";
  import { adoptSessionKey, keyLinkOpen } from "$lib/sessionKey";
  import {
    PAIRING_LENS,
    buildDeepLink,
    buildStartParam,
    generateEphemeral,
    newChannelId,
    openKey,
    type PairingEnvelope,
  } from "$lib/pairing";

  const POLL_MS = 2500;
  const TIMEOUT_MS = 3 * 60 * 1000;

  const miniapp = resolveMiniapp();
  let qrDataUrl = "";
  let deepLink = "";
  let state: "waiting" | "success" | "timeout" | "failed" | "mismatch" =
    "waiting";
  let timer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;

  const eph = generateEphemeral();
  const channel = newChannelId();

  async function poll() {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      stop();
      state = "timeout";
      return;
    }
    let envelope: PairingEnvelope | null = null;
    try {
      const hs = await getHolosphere();
      envelope = (await hs.getGlobal(
        PAIRING_LENS,
        channel,
      )) as PairingEnvelope | null;
    } catch {
      return; // relay hiccup — next tick retries
    }
    if (!envelope?.ct) return;
    // The envelope claims a sender; a mismatch with the logged-in editor means
    // someone else's phone answered this QR — refuse rather than sign as them.
    const me = get(currentUser);
    if (envelope.telegramId && me && envelope.telegramId !== String(me.id)) {
      stop();
      state = "mismatch";
      void cleanup();
      return;
    }
    const secret = await openKey(eph.privHex, envelope);
    if (!secret) return; // foreign/tampered envelope — keep waiting
    stop();
    const pubkey = await adoptSessionKey(secret);
    state = pubkey ? "success" : "failed";
    void cleanup();
    if (pubkey) setTimeout(() => keyLinkOpen.set(false), 1500);
  }

  async function cleanup() {
    try {
      (await getHolosphere()).deleteGlobal(PAIRING_LENS, channel);
    } catch {
      /* best effort — envelopes also expire by TTL */
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  onMount(async () => {
    if (!miniapp) return;
    deepLink = buildDeepLink(miniapp, buildStartParam(channel, eph.pubHex));
    try {
      qrDataUrl = await QRCode.toDataURL(deepLink, { margin: 1, width: 260 });
    } catch {
      /* link text below still works */
    }
    startedAt = Date.now();
    timer = setInterval(() => void poll(), POLL_MS);
  });

  onDestroy(stop);
</script>

<div class="keylink">
  <h2>{$t("keylink.title")}</h2>
  {#if !miniapp}
    <p class="hint">{$t("keylink.noMiniapp")}</p>
  {:else if state === "waiting"}
    {#if qrDataUrl}
      <img class="qr" src={qrDataUrl} alt={$t("keylink.qrAlt")} />
    {/if}
    <p class="hint">{$t("keylink.scan")}</p>
    <a class="link" href={deepLink} target="_blank" rel="noopener">
      {deepLink}
    </a>
    <p class="pulse">{$t("keylink.waiting")}</p>
  {:else if state === "success"}
    <p class="ok">✓ {$t("keylink.success")}</p>
  {:else if state === "mismatch"}
    <p class="err">{$t("keylink.mismatch")}</p>
  {:else if state === "timeout"}
    <p class="err">{$t("keylink.timeout")}</p>
  {:else}
    <p class="err">{$t("keylink.failed")}</p>
  {/if}
</div>

<style>
  .keylink {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0.25rem;
    max-width: 20rem;
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .qr {
    width: 13rem;
    height: 13rem;
    border-radius: 0.6rem;
    background: #fff;
    padding: 0.4rem;
  }
  .hint {
    margin: 0;
    opacity: 0.85;
    font-size: 0.9rem;
  }
  .link {
    font-size: 0.72rem;
    word-break: break-all;
    opacity: 0.6;
  }
  .pulse {
    margin: 0;
    font-size: 0.85rem;
    opacity: 0.7;
    animation: fade 1.6s ease-in-out infinite alternate;
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
    color: var(--teal);
    font-weight: 600;
  }
  .err {
    color: #d05353;
    margin: 0;
    font-size: 0.9rem;
  }
</style>
