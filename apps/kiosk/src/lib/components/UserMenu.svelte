<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  import { shortId } from "@holons/core/identity";
  import { toNpub, toNsec } from "@holons/core/nostr";
  // The single entry point behind the header account chip, in two parts:
  //   you    — who is signed in (name, key id, copy), your own holon with
  //            what is open in it, and one folded "Your key" row holding
  //            the rarer key chores: back it up, link it to Telegram,
  //            unlink it from this hub, forget it on this device. A key the
  //            hub has not linked yet is the one thing said out loud, with
  //            the button that asks for the link;
  //   board  — this holon's Settings (the only way in), dashboard, install;
  //            then logging out. (Leaving a board is the window's ✕.)
  // (Federated visibility lives in the pills band's Filters sheet.)
  import { currentUser, displayName, loginOpen, logout } from "$lib/auth";
  import {
    showNotice,
    holonId,
    holonName,
    settingsOpen,
    userMenuOpen,
    writeStanding,
  } from "$lib/stores";
  import { clearBotHandoff, dashboardUrl } from "$lib/config";
  import { clearHubClaim } from "$lib/hubclaim";
  import { travelTo } from "$lib/dock";
  import { sessionKeyPub, getSessionSecret } from "$lib/sessionKey";
  import { forgetRememberedKey, readRememberedKey } from "$lib/rememberKey";
  import { installMode, promptInstall } from "$lib/install";
  import { askToJoin, leave } from "$lib/hubmembers";
  import { offerKeyLink } from "$lib/keylink";
  import { isHolonId, isTelegramChatId } from "@holons/core/protocol";
  import { t, tr } from "$lib/i18n";
  import { fedRequests } from "$lib/fedrequests";
  import { myHolonOpen } from "$lib/myholon";
  import { starredHolon, toggleStar } from "$lib/star";

  $: who = $holonName;

  function close() {
    userMenuOpen.set(false);
  }
  function openDashboard() {
    if ($holonId) window.open(dashboardUrl($holonId), "_blank", "noopener");
    close();
  }
  function openSettings() {
    close();
    settingsOpen.set(true);
  }
  // The star: the holon this device opens by itself (see $lib/star).
  $: starred = !!$holonId && $starredHolon === $holonId;
  function star() {
    if (!$holonId) return;
    showNotice(
      toggleStar($holonId)
        ? tr("menu.starDone", { name: who || $holonId })
        : tr("menu.starRemoved"),
    );
  }
  function login() {
    close();
    loginOpen.set(true);
  }

  // ── You ────────────────────────────────────────────────────────────────
  // The signed-in person's own holon IS their id (Telegram id or pubkey hex).
  // Going there is a change of place, so it travels like one: the board on
  // screen closes into its circle, the map / holosphere shows a moment, then
  // the personal holon's circle opens (see dock `travelTo`).
  $: myHolonId = $currentUser ? String($currentUser.id) : null;
  $: onMyHolon = myHolonId != null && $holonId === myHolonId;
  function openMyHolon() {
    close();
    if (!myHolonId || onMyHolon || !$currentUser) return;
    settingsOpen.set(false);
    clearBotHandoff();
    clearHubClaim();
    travelTo(myHolonId, {
      name: displayName($currentUser),
      from: $holonId,
    });
  }

  // ── Key ────────────────────────────────────────────────────────────────
  $: telegramKey = $currentUser?.provider === "telegram";
  // Re-read whenever the key changes: a PIN-sealed copy may come or go.
  let remembered = false;
  $: remembered =
    !!$sessionKeyPub && readRememberedKey()?.pubkey === $sessionKeyPub;

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice(done);
    } catch {
      showNotice(tr("menu.copyFailed"));
    }
  }
  function copyNpub() {
    if ($sessionKeyPub) void copy(toNpub($sessionKeyPub), tr("menu.copied"));
  }
  // The secret leaves only on a second, deliberate tap: the first arms the
  // row and says what is about to happen; it disarms itself after a moment.
  let backupArmed = false;
  let backupTimer: ReturnType<typeof setTimeout> | null = null;
  function backupKey() {
    const secret = getSessionSecret();
    if (!secret) return;
    if (!backupArmed) {
      backupArmed = true;
      if (backupTimer) clearTimeout(backupTimer);
      backupTimer = setTimeout(() => (backupArmed = false), 6000);
      return;
    }
    backupArmed = false;
    if (backupTimer) clearTimeout(backupTimer);
    void copy(toNsec(secret), tr("menu.backupCopied"));
  }
  $: if (!$sessionKeyPub) backupArmed = false;
  // The secret lives in module memory beside the pubkey (same lifetime).
  $: hasSecret = !!$sessionKeyPub && !!getSessionSecret();

  // Linking this key to the person's Telegram account: the proof is signed
  // and published here, Telegram only taps (see $lib/keylink).
  let tgLinkUrl = "";
  let tgLinkBusy = false;
  $: if (!$sessionKeyPub) tgLinkUrl = "";
  async function linkTelegram() {
    if (!$sessionKeyPub || tgLinkBusy) return;
    tgLinkBusy = true;
    try {
      tgLinkUrl = (await offerKeyLink()).url;
    } catch (err) {
      showNotice(
        tr("members.linkTelegramFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      tgLinkBusy = false;
    }
  }

  function forgetKey() {
    forgetRememberedKey();
    remembered = false;
    showNotice(tr("menu.forgot"));
  }

  // Hubs with a signed roster take members by key — founded from a screen
  // or born in Telegram (its bot founds the log): ask to be linked, or say
  // goodbye. The fuller story, and the same ask, live in Settings → Members.
  let joinBusy = false;
  $: keyHub =
    !!$holonId &&
    (isHolonId($holonId) || isTelegramChatId($holonId)) &&
    !!$sessionKeyPub;
  async function joinHub() {
    if (!$holonId || !$currentUser || joinBusy) return;
    joinBusy = true;
    try {
      if (await askToJoin($holonId, displayName($currentUser)))
        showNotice(tr("menu.linkAsked"));
    } finally {
      joinBusy = false;
    }
  }
  async function leaveHub() {
    if (!$holonId || joinBusy) return;
    joinBusy = true;
    try {
      if (await leave($holonId)) showNotice(tr("menu.unlinked"));
    } finally {
      joinBusy = false;
    }
  }

  // The key chores stay folded until asked for; the row shows only when it
  // has something to unfold.
  let keyOpen = false;
  $: if (!$sessionKeyPub) keyOpen = false;
  $: keyChores =
    (keyHub && $writeStanding === "accepted") ||
    !telegramKey ||
    hasSecret ||
    remembered;

  // Add to Home Screen: where the browser lends us its install dialog, the
  // row IS the button; everywhere else it unfolds the steps in place (iOS has
  // no API, only Share → "Add to Home Screen").
  let installSteps = false;
  function install() {
    if ($installMode === "prompt") void promptInstall();
    else installSteps = !installSteps;
  }
</script>

<div class="menu">
  <!-- ── You ── -->
  <div class="id">
    {#if $currentUser}
      {#if $currentUser.photo_url}
        <img class="avatar" src={$currentUser.photo_url} alt="" />
      {:else}
        <span class="avatar initial"
          >{$currentUser.first_name?.[0]?.toUpperCase() ?? "·"}</span
        >
      {/if}
      {#if $sessionKeyPub}
        <!-- Your name and key id are one target: a tap copies the npub. -->
        <button
          class="idtext copy"
          on:click={copyNpub}
          title={toNpub($sessionKeyPub)}
          aria-label={$t("menu.copyNpub")}
        >
          <span class="name">{displayName($currentUser)}</span>
          <span class="sub mono"
            ><span class="keyid">{shortId($sessionKeyPub)}</span><Icon
              name="share"
            /></span
          >
        </button>
      {:else}
        <div class="idtext">
          <span class="name">{displayName($currentUser)}</span>
        </div>
      {/if}
    {:else}
      <span class="avatar initial"><Icon name="star" /></span>
      <div class="idtext">
        <span class="name">{$t("menu.notSignedIn")}</span>
        {#if who}<span class="sub">{who}</span>{/if}
      </div>
    {/if}
  </div>

  {#if $currentUser && myHolonId}
    <!-- Your own holon, by its id — distinct from the displayed board — with
         what is still open in it, the same red count as on your face. -->
    <button
      class="mine"
      class:here={onMyHolon}
      on:click={openMyHolon}
      aria-current={onMyHolon ? "page" : undefined}
    >
      <span class="mine__ico"><Icon name="home" /></span>
      <span class="label"
        >{$t("menu.myHolon")}<span class="hint"
          >{#if onMyHolon}{$t("menu.youAreHere")}{:else if $myHolonOpen}{$t(
              "menu.myHolonOpen",
              { n: $myHolonOpen },
            )}{:else}{$t("menu.myHolonClear")}{/if}</span
        ></span
      >
      {#if $myHolonOpen}<span
          class="alert"
          aria-label={$t("menu.myHolonOpen", { n: $myHolonOpen })}
          >{$myHolonOpen > 99 ? "99+" : $myHolonOpen}</span
        >{/if}
      {#if !onMyHolon}<span class="chev">›</span>{/if}
    </button>
  {:else if !$currentUser}
    <button class="row primary" on:click={login}>
      <span class="ico"><Icon name="star" /></span>
      <span class="label">{$t("menu.login")}</span>
    </button>
  {/if}

  <!-- ── Key ── -->
  {#if $currentUser && $sessionKeyPub}
    <!-- Reads are enforced, so a key the hub has not linked writes only for
         itself: say so, with the ask right under it. A linked key needs no
         banner — the folded row below carries that in its hint. -->
    {#if $writeStanding === "held"}
      <div class="standing held" role="status">
        <Icon name="lock" /><span>{$t("menu.notLinked")}</span>
      </div>
      {#if keyHub}
        <button class="row primary" disabled={joinBusy} on:click={joinHub}>
          <span class="ico"><Icon name="link" /></span>
          <span class="label">{$t("menu.linkMe")}</span>
        </button>
      {/if}
    {/if}

    {#if keyChores}
      <button
        class="row"
        on:click={() => (keyOpen = !keyOpen)}
        aria-expanded={keyOpen}
        aria-controls="menu-key"
      >
        <span class="ico"><Icon name="key" /></span>
        <span class="label"
          >{$t("menu.keyTitle")}<span class="hint"
            >{$writeStanding === "accepted"
              ? $t("menu.linked")
              : telegramKey
                ? $t("menu.keyFromTelegram")
                : remembered
                  ? $t("menu.keyRemembered")
                  : $t("menu.keyThisSession")}</span
          ></span
        >
        <span class="chev" class:open={keyOpen}>›</span>
      </button>
      {#if keyOpen}
        <div class="key__actions" id="menu-key">
          {#if !telegramKey}
            {#if tgLinkUrl}
              <a
                class="act strong"
                href={tgLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="chat" /><span>{$t("menu.linkTelegramOpen")}</span>
              </a>
            {:else}
              <button class="act" disabled={tgLinkBusy} on:click={linkTelegram}>
                <Icon name="chat" /><span>{$t("menu.linkTelegram")}</span>
              </button>
            {/if}
          {/if}
          {#if hasSecret}
            <button
              class="act"
              class:armed={backupArmed}
              on:click={backupKey}
              aria-live="polite"
            >
              <Icon name={backupArmed ? "warning" : "key"} /><span
                >{backupArmed
                  ? $t("menu.backupConfirm")
                  : $t("menu.backupKey")}</span
              >
            </button>
          {/if}
          {#if remembered}
            <button class="act" on:click={forgetKey}>
              <Icon name="unlock" /><span>{$t("menu.forgetKey")}</span>
            </button>
          {/if}
          {#if keyHub && $writeStanding === "accepted"}
            <button class="act" disabled={joinBusy} on:click={leaveHub}>
              <Icon name="close" /><span>{$t("menu.unlinkMe")}</span>
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}

  <!-- ── This board ── -->
  {#if $holonId}
    <h3 class="group">{who || $t("menu.thisBoard")}</h3>
  {/if}
  {#if $holonId}
    <button class="row" class:starred on:click={star} aria-pressed={starred}>
      <span class="ico"><Icon name={starred ? "star" : "star-outline"} /></span>
      <span class="label"
        >{starred ? $t("menu.starred") : $t("menu.star")}<span class="hint"
          >{$t("menu.starHint")}</span
        ></span
      >
    </button>
  {/if}
  <button class="row" on:click={openSettings}>
    <span class="ico"><Icon name="gear" /></span>
    <span class="label"
      >{$t("menu.settings")}{#if $fedRequests.length}<span class="hint"
          >{$t("fed.requestsBadge", { n: $fedRequests.length })}</span
        >{/if}</span
    >
    {#if $fedRequests.length}<span class="count">{$fedRequests.length}</span
      >{/if}
    <span class="chev">›</span>
  </button>

  <button class="row" on:click={openDashboard} disabled={!$holonId}>
    <span class="ico"><Icon name="hexagon" /></span>
    <span class="label">{$t("menu.dashboard")}</span>
    <span class="chev"><Icon name="arrow-up-right" /></span>
  </button>

  {#if $installMode !== "hidden"}
    <button
      class="row"
      on:click={install}
      aria-expanded={$installMode === "prompt" ? undefined : installSteps}
    >
      <span class="ico"><Icon name="smartphone" /></span>
      <span class="label">{$t("menu.install")}</span>
      <span class="chev"
        >{#if $installMode === "prompt"}<Icon name="plus" />{:else}›{/if}</span
      >
    </button>
    {#if installSteps && $installMode !== "prompt"}
      <div class="install">
        <p>{$t("install.hint", { name: who || "Holons" })}</p>
        {#if $installMode === "ios"}
          <ol>
            <li>
              <span class="step-ico"><Icon name="share" /></span>
              {$t("install.iosShare")}
            </li>
            <li>
              <span class="step-ico"><Icon name="plus-square" /></span>
              {$t("install.iosAdd")}
            </li>
            <li>
              <span class="step-ico"><Icon name="check" /></span>
              {$t("install.iosConfirm")}
            </li>
          </ol>
        {:else}
          <p>{$t("install.manual")}</p>
        {/if}
      </div>
    {/if}
  {/if}

  {#if $currentUser}
    <div class="foot">
      <button class="row danger" on:click={logout}>
        <span class="ico"><Icon name="power" /></span>
        <span class="label">{$t("menu.logout")}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .id {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.2rem 0.2rem 0.5rem;
  }
  .avatar {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    object-fit: cover;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 1.1rem;
    font-weight: 800;
  }
  .idtext {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 0.85rem;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mono {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }

  /* Your own holon: the one big target, right under your name. */
  .mine {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    min-height: 60px;
    padding: 0.4rem 0.9rem;
    border-radius: 16px;
    background: var(--teal-wash);
    border: 1px solid color-mix(in srgb, var(--teal) 35%, transparent);
    color: var(--ink);
    text-align: left;
    transition: transform 0.1s ease;
  }
  .mine:active {
    transform: scale(0.98);
  }
  .mine.here {
    cursor: default;
  }
  .mine__ico {
    flex: 0 0 auto;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 1.2rem;
  }
  .alert {
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.85rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    background: var(--alert);
    color: var(--on-alert);
  }

  /* Your name and key id, as the copy-your-key button. Stops short of the
     sheet's close control in the corner. */
  .idtext.copy {
    align-items: flex-start;
    min-height: 44px;
    justify-content: center;
    margin-right: 2.6rem;
    text-align: left;
    border-radius: 10px;
  }
  .idtext.copy:active {
    transform: scale(0.98);
  }
  .idtext.copy .name,
  .idtext.copy .sub {
    max-width: 100%;
  }
  .idtext.copy .sub {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .keyid {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .idtext.copy .sub :global(svg) {
    flex: 0 0 auto;
    color: var(--teal-ink);
  }
  .standing {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: 10px;
    font-size: 0.85rem;
    line-height: 1.3;
    color: var(--ink);
    background: var(--paper);
  }
  .standing :global(svg) {
    flex: 0 0 auto;
    margin-top: 0.1rem;
    color: var(--teal-ink);
  }
  .standing.held {
    background: color-mix(in srgb, #b45309 12%, var(--paper));
  }
  .standing.held :global(svg) {
    color: var(--caution);
  }
  /* The key chores, unfolded under the "Your key" row. */
  .key__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
    padding: 0 0 0.2rem 0.6rem;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 44px;
    padding: 0.35rem 0.65rem;
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.85rem;
    line-height: 1.2;
    text-align: left;
    text-decoration: none;
  }
  .act :global(svg) {
    flex: 0 0 auto;
    color: var(--teal-ink);
  }
  .act:only-child {
    grid-column: 1 / -1;
  }
  .act.strong {
    grid-column: 1 / -1;
    background: var(--teal);
    color: var(--on-teal);
  }
  .act.strong :global(svg) {
    color: var(--on-teal);
  }
  .act.armed {
    grid-column: 1 / -1;
    outline: 2px solid var(--caution);
    outline-offset: -2px;
  }
  .act.armed :global(svg) {
    color: var(--caution);
  }
  .act:disabled {
    opacity: 0.45;
  }

  .group {
    margin: 0.5rem 0.3rem 0;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    min-height: 52px;
    padding: 0 0.9rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    text-align: left;
    transition:
      background 0.15s ease,
      transform 0.1s ease;
  }
  .row:active {
    transform: scale(0.98);
  }
  .row:disabled {
    opacity: 0.45;
  }
  .row .ico {
    flex: 0 0 auto;
    width: 1.5rem;
    text-align: center;
    font-size: 1.15rem;
    color: var(--teal-ink);
  }
  .label {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 1rem;
  }
  .row .count {
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.4rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    font-weight: 800;
    background: var(--caution);
    color: var(--paper);
  }
  .chev {
    color: var(--ink-soft);
    font-weight: 700;
    transition: transform 0.15s ease;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .label .hint {
    display: block;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .foot {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem;
    margin-top: 0.4rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }
  .foot .row {
    min-height: 48px;
    gap: 0.5rem;
  }
  .foot .row .label {
    font-size: 0.9rem;
  }
  .foot .row:only-child {
    grid-column: 1 / -1;
  }

  .install {
    padding: 0.2rem 0.9rem 0.6rem;
    color: var(--ink);
    font-size: 0.95rem;
    line-height: 1.35;
  }
  .install p {
    margin: 0 0 0.5rem;
    color: var(--ink-soft);
  }
  .install ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .install li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    font-weight: 600;
  }
  .step-ico {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: var(--paper);
    color: var(--teal-ink);
    font-size: 1.15rem;
  }

  .row.primary {
    background: var(--teal);
    color: var(--on-teal);
    box-shadow: var(--shadow-soft);
  }
  .row.primary .ico {
    color: var(--on-teal);
  }
  .row.starred .ico {
    color: var(--caution);
  }
  .row.danger .ico {
    color: var(--danger);
  }
</style>
