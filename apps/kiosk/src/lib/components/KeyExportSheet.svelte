<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // "Your key": take your own signing identity to another Nostr app.
  //
  // The npub is always shown. The secret leaves only by the person's
  // deliberate hand: an encrypted backup (NIP-49, the recommended way, since
  // the file is useless without the password) or the bare nsec behind a
  // warning, masked until tapped and hidden again after a minute, when the
  // tab is hidden, on logout, or when the sheet closes. A kiosk can be a
  // shared wall screen, so nothing here is persisted, sent or logged: the
  // secret is read from session memory (sessionKey.ts) at the moment it is
  // needed and dropped from this component as soon as it is hidden.
  // A wallet login's key is re-derived from the wallet on every sign-in;
  // there is nothing of its own to export, and the sheet says so.
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import SidePanel from "$lib/components/SidePanel.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { t, tr } from "$lib/i18n";
  import { currentUser } from "$lib/auth";
  import { getSessionSecret, sessionKeyPub } from "$lib/sessionKey";
  import {
    BACKUP_PASSWORD_MIN,
    backupPasswordProblem,
    npubOf,
    nsecOf,
    sealKeyBackup,
  } from "@holons/core/auth";

  const dispatch = createEventDispatcher<{ close: void }>();
  const AUTO_HIDE_S = 60;

  function close() {
    hideSecret();
    dispatch("close");
  }

  $: pub = $sessionKeyPub;
  $: npub = pub ? npubOf(pub) : "";
  $: wallet = $currentUser?.provider === "ethereum";
  // Read on every change of identity, never cached beyond it.
  $: hasSecret = !!pub && !wallet && getSessionSecret() != null;

  // Logged out, or the key changed under us: the sheet has nothing to show.
  $: if (!$currentUser || !pub) close();
  $: if (step === "shown" && pub !== shownFor) hideSecret();

  // ── Copy ──
  let copied: "npub" | "nsec" | null = null;
  let copyError = "";
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  async function copy(which: "npub" | "nsec") {
    copyError = "";
    const text = which === "npub" ? npub : nsec;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = which;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = null), 1800);
    } catch {
      copyError = tr("login.copyFailed");
    }
  }

  // ── The bare secret: warning → revealed (masked until tapped) ──
  let step: "idle" | "warn" | "shown" = "idle";
  let nsec = "";
  let plain = false;
  let shownFor: string | null = null;
  let left = AUTO_HIDE_S;
  let ticker: ReturnType<typeof setInterval> | null = null;

  function reveal() {
    const sk = getSessionSecret();
    if (!sk || wallet) return hideSecret();
    nsec = nsecOf(sk);
    shownFor = pub;
    step = "shown";
    plain = false;
    left = AUTO_HIDE_S;
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => {
      left -= 1;
      if (left <= 0) hideSecret();
    }, 1000);
  }

  function hideSecret() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    nsec = "";
    plain = false;
    step = "idle";
    shownFor = null;
    if (copied === "nsec") copied = null;
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") hideSecret();
  }

  // ── Encrypted backup ──
  let password = "";
  let again = "";
  let tried = false;
  let sealing = false;
  let savedAs = "";
  $: problem = backupPasswordProblem(password, again);
  // Say "too short" while typing the first; "not the same" only once the
  // second has been typed out (or a download was tried).
  $: hint =
    problem === "short" && (password.length > 0 || tried)
      ? tr("keyexport.passwordShort", { n: BACKUP_PASSWORD_MIN })
      : problem === "mismatch" && (again.length >= password.length || tried)
        ? tr("keyexport.passwordMismatch")
        : "";

  async function downloadBackup() {
    tried = true;
    savedAs = "";
    if (problem || sealing) return;
    const sk = getSessionSecret();
    if (!sk || wallet) return;
    sealing = true;
    // scrypt takes about a second on the main thread: paint "Locking…" first.
    await tick();
    await new Promise((r) => setTimeout(r, 30));
    try {
      const backup = sealKeyBackup(sk, password, again);
      if (!backup.ok) return;
      saveFile(backup.text, backup.fileName);
      savedAs = backup.fileName;
      password = "";
      again = "";
      tried = false;
    } finally {
      sealing = false;
    }
  }

  /** Hand the file to the browser's download; the blob is gone right after. */
  function saveFile(text: string, name: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  onDestroy(() => {
    hideSecret();
    if (copiedTimer) clearTimeout(copiedTimer);
    password = "";
    again = "";
  });
</script>

<svelte:document on:visibilitychange={onVisibility} />

<SidePanel title={$t("keyexport.title")} on:close={close}>
  <div class="sheet">
    <section class="block">
      <h3>{$t("keyexport.publicLabel")}</h3>
      <div class="keybox">
        <code class="npub">{npub}</code>
        <button
          class="copy"
          on:click={() => copy("npub")}
          aria-label={`${$t("login.copy")}: ${$t("keyexport.publicLabel")}`}
        >
          <Icon name={copied === "npub" ? "check" : "copy"} />
          <span
            >{copied === "npub" ? $t("login.copied") : $t("login.copy")}</span
          >
        </button>
      </div>
      <p class="note">{$t("keyexport.publicNote")}</p>
    </section>

    {#if wallet}
      <p class="info" role="note">
        <Icon name="info" />
        <span>{$t("keyexport.walletNote")}</span>
      </p>
    {:else if !hasSecret}
      <p class="info" role="note">
        <Icon name="info" />
        <span>{$t("keyexport.noSecret")}</span>
      </p>
    {:else}
      <section class="block recommended">
        <h3>
          <Icon name="lock" />
          <span>{$t("keyexport.backupTitle")}</span>
          <span class="badge">{$t("keyexport.recommended")}</span>
        </h3>
        <p class="note">{$t("keyexport.backupNote")}</p>
        <form on:submit|preventDefault={downloadBackup}>
          <!-- A username field for password managers, never shown. -->
          <input
            class="sr"
            type="text"
            autocomplete="username"
            value={npub}
            readonly
            tabindex="-1"
            aria-hidden="true"
          />
          <label class="field">
            <span>{$t("keyexport.password")}</span>
            <input
              type="password"
              bind:value={password}
              autocomplete="new-password"
              minlength={BACKUP_PASSWORD_MIN}
              aria-invalid={hint && problem === "short" ? "true" : undefined}
              aria-describedby="keyexport-hint"
            />
          </label>
          <label class="field">
            <span>{$t("keyexport.passwordAgain")}</span>
            <input
              type="password"
              bind:value={again}
              autocomplete="new-password"
              aria-invalid={hint && problem === "mismatch" ? "true" : undefined}
              aria-describedby="keyexport-hint"
            />
          </label>
          <p id="keyexport-hint" class="hint" aria-live="polite">{hint}</p>
          <button class="primary" type="submit" disabled={sealing || !!problem}>
            <Icon name="download" />
            <span
              >{sealing
                ? $t("keyexport.sealing")
                : $t("keyexport.download")}</span
            >
          </button>
        </form>
        {#if savedAs}
          <p class="ok" role="status">
            <Icon name="check" />
            <span>{$t("keyexport.downloaded", { file: savedAs })}</span>
          </p>
        {/if}
        <p class="note">{$t("keyexport.passwordLost")}</p>
      </section>

      <section class="block">
        <h3>{$t("keyexport.secretTitle")}</h3>
        {#if step === "idle"}
          <button class="ghost" on:click={() => (step = "warn")}>
            <Icon name="key" />
            <span>{$t("keyexport.showSecret")}</span>
          </button>
        {:else if step === "warn"}
          <div class="warn" role="alert">
            <Icon name="warning" />
            <span>{$t("keyexport.warn")}</span>
          </div>
          <div class="row2">
            <button class="ghost" on:click={hideSecret}
              >{$t("common.cancel")}</button
            >
            <button class="danger" on:click={reveal}>
              <Icon name="eye" />
              <span>{$t("keyexport.reveal")}</span>
            </button>
          </div>
        {:else}
          <div class="keybox secret">
            <button
              class="mask"
              class:plain
              on:click={() => (plain = !plain)}
              aria-pressed={plain}
              aria-label={plain
                ? $t("keyexport.hide")
                : $t("keyexport.tapToShow")}
            >
              {#if plain}
                <code>{nsec}</code>
              {:else}
                <code aria-hidden="true">nsec1••••••••••••••••••••••••</code>
                <span class="tap">{$t("keyexport.tapToShow")}</span>
              {/if}
            </button>
            <button
              class="copy"
              on:click={() => copy("nsec")}
              aria-label={`${$t("login.copy")}: ${$t("keyexport.secretTitle")}`}
            >
              <Icon name={copied === "nsec" ? "check" : "copy"} />
              <span
                >{copied === "nsec"
                  ? $t("login.copied")
                  : $t("login.copy")}</span
              >
            </button>
          </div>
          <div class="row2">
            <p class="note" aria-live="off">
              {$t("keyexport.autoHide", { s: left })}
            </p>
            <button class="ghost" on:click={hideSecret}>
              <Icon name="close" />
              <span>{$t("keyexport.hide")}</span>
            </button>
          </div>
        {/if}
      </section>
    {/if}

    {#if copyError}<p class="bad" role="alert">{copyError}</p>{/if}
    <p class="note">{$t("keyexport.stays")}</p>
  </div>
</SidePanel>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 0.4rem;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .block.recommended {
    padding: 0.9rem;
    border-radius: 16px;
    border: 1.5px solid var(--teal);
    background: color-mix(in srgb, var(--teal) 7%, var(--card));
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--ink);
  }
  h3 :global(.icon) {
    color: var(--teal-ink);
  }
  .badge {
    margin-left: auto;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    background: var(--teal);
    color: var(--on-teal);
  }
  .note {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--ink-soft);
  }
  .info {
    margin: 0;
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    padding: 0.8rem 0.9rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.92rem;
    line-height: 1.4;
  }
  .info :global(.icon) {
    margin-top: 0.15rem;
    color: var(--teal-ink);
  }
  .keybox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    border-radius: 12px;
    border: 1px dashed var(--line);
    background: var(--paper);
  }
  .keybox code {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    line-height: 1.35;
    word-break: break-all;
    color: var(--ink);
  }
  .keybox.secret {
    border-style: solid;
    border-color: var(--danger);
    padding-left: 0.3rem;
  }
  .mask {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.1rem;
    padding: 0.3rem 0.45rem;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    text-align: left;
  }
  .mask code {
    width: 100%;
  }
  .mask:not(.plain) code {
    color: var(--muted);
    letter-spacing: 0.05em;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .tap {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--teal-ink);
  }
  .copy,
  .ghost,
  .danger,
  .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 44px;
    padding: 0 0.9rem;
    border-radius: 12px;
    font-weight: 700;
    font-size: 0.9rem;
    flex: 0 0 auto;
    touch-action: manipulation;
  }
  .copy,
  .ghost {
    background: var(--paper-deep);
    color: var(--ink);
  }
  .ghost {
    align-self: flex-start;
  }
  .danger {
    background: var(--danger);
    color: var(--card);
  }
  .primary {
    min-height: 48px;
    border-radius: 14px;
    background: var(--teal);
    color: var(--on-teal);
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .copy:active,
  .ghost:active,
  .danger:active,
  .primary:active:not(:disabled) {
    transform: scale(0.97);
  }
  .warn {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    padding: 0.75rem 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 9%, var(--card));
    color: var(--ink);
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.4;
  }
  .warn :global(.icon) {
    margin-top: 0.15rem;
    color: var(--danger);
    flex: 0 0 auto;
  }
  .row2 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .row2 .ghost {
    align-self: auto;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .field input {
    min-height: 48px;
    padding: 0 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font-size: 1rem;
  }
  .field input[aria-invalid="true"] {
    border-color: var(--danger);
  }
  .hint {
    margin: 0;
    min-height: 1.1em;
    font-size: 0.82rem;
    color: var(--danger);
  }
  .ok {
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--teal-ink);
    word-break: break-all;
  }
  .bad {
    margin: 0;
    font-size: 0.85rem;
    color: var(--danger);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
  }
</style>
