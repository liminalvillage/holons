<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The one-shot link an admin gets when someone asks to be linked to a
  // holon with no chat of its own (`<board>/<holon>?link=<key>`, core
  // `joinLinkUrl` — in their task and in the bot's message). It opens the
  // holon straight on the question: "Link Kamala?". The link holds no
  // authority: the answer is signed by the admin's own key, so anyone else
  // is told to log in or that only an admin can. Used once, the key is
  // linked; opened again it only says so.
  import { onMount } from "svelte";
  import { replaceState } from "$app/navigation";
  import { JOIN_LINK_PARAM, parseJoinLink } from "@holons/core/holons";
  import { may } from "@holons/core/holosphere";
  import { holonMembers } from "@holons/core/protocol";
  import { shortId } from "@holons/core/identity";
  import { holonId, holonName, showNotice, standing } from "$lib/stores";
  import { authSettled, isLoggedIn, loginOpen } from "$lib/auth";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { getHolosphere } from "$lib/holosphere";
  import { seat } from "$lib/hubmembers";
  import { joinAsks, settleJoinAsk } from "$lib/joinasks";
  import { nameOf } from "$lib/names";
  import { READINESS_LABEL, readinessWarns } from "$lib/dna";
  import { t } from "$lib/i18n";
  import Modal from "./Modal.svelte";

  /** The key the link names; null once answered or waved away. */
  let key: string | null = null;
  /** The holon the link was opened on: another board is not asked. */
  let forHolon: string | null = null;
  let busy = false;
  /** null until the roster was read for this key. */
  let linked: boolean | null = null;

  onMount(() => {
    key = parseJoinLink(location.search);
  });

  $: if (key && !forHolon && $holonId) forHolon = $holonId;
  $: here = !!key && !!forHolon && forHolon === $holonId;
  $: canLink = !!$standing && may($standing, "members");
  $: label = $holonName || $holonId || "";
  $: asked = key ? ($joinAsks.find((r) => r.pubkey === key) ?? null) : null;
  $: who = key ? asked?.reason.trim() || $nameOf(key) || shortId(key) : "";

  // Already linked? Read once the admin's key is up (and again per key).
  let checkedFor = "";
  $: if (here && canLink && key && checkedFor !== `${forHolon}|${key}`) {
    checkedFor = `${forHolon}|${key}`;
    void check(forHolon as string, key);
  }
  async function check(holon: string, pub: string) {
    try {
      const hs = await getHolosphere();
      const has = (await holonMembers(hs, holon)).has(pub);
      if (pub !== key) return;
      if (has) {
        showNotice($t("joinlink.already", { name: who, holon: label }));
        done();
      } else linked = false;
    } catch {
      if (pub === key) linked = false;
    }
  }

  /** Put the link away: the address no longer carries it. */
  function done() {
    key = null;
    try {
      const params = new URLSearchParams(location.search);
      params.delete(JOIN_LINK_PARAM);
      const q = params.toString();
      replaceState(location.pathname + (q ? `?${q}` : "") + location.hash, {});
    } catch {
      /* the router is not up yet: the param only lingers */
    }
  }

  async function link() {
    if (!key || !forHolon || busy) return;
    busy = true;
    try {
      const pub = await seat(forHolon, key, "member", asked?.reason);
      settleJoinAsk(pub);
      showNotice($t("joinlink.linked", { name: who, holon: label }));
      done();
    } catch (err) {
      showNotice(
        $t("members.failed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      busy = false;
    }
  }
</script>

{#if here && !$loginOpen}
  {#if !$isLoggedIn || !$sessionKeyPub}
    <!-- Asked to log in only once the boot knows nobody is. -->
    {#if $authSettled}
      <Modal on:close={done} label={$t("joinlink.title", { name: who })}>
        <div class="ask">
          <h4>{$t("joinlink.title", { name: who })}</h4>
          <p>{$t("joinlink.login", { holon: label })}</p>
          <div class="actions">
            <button type="button" on:click={done}>{$t("common.cancel")}</button>
            <button
              type="button"
              class="primary"
              on:click={() => loginOpen.set(true)}>{$t("onb.login")}</button
            >
          </div>
        </div>
      </Modal>
    {/if}
  {:else if $standing && !canLink}
    <Modal on:close={done} label={$t("joinlink.title", { name: who })}>
      <div class="ask">
        <h4>{$t("joinlink.title", { name: who })}</h4>
        <p>{$t("joinlink.notAdmin", { holon: label })}</p>
        <div class="actions">
          <button type="button" class="primary" on:click={done}
            >{$t("common.close")}</button
          >
        </div>
      </div>
    </Modal>
  {:else if canLink && linked === false}
    <Modal on:close={done} label={$t("joinlink.title", { name: who })}>
      <div class="ask">
        <h4>{$t("joinlink.title", { name: who })}</h4>
        <p>{$t("joinlink.body", { name: who, holon: label })}</p>
        <p class="key" title={key}>
          {shortId(
            key ?? "",
          )}{#if asked && READINESS_LABEL[asked.readiness]}<span
              class="ready"
              class:warn={readinessWarns(asked.readiness)}
              >{$t(READINESS_LABEL[asked.readiness] ?? "ready.missing")}</span
            >{/if}
        </p>
        <div class="actions">
          <button type="button" disabled={busy} on:click={done}
            >{$t("joinlink.later")}</button
          >
          <button type="button" class="primary" disabled={busy} on:click={link}
            >{$t("members.approve")}</button
          >
        </div>
      </div>
    </Modal>
  {/if}
{/if}

<style>
  .ask {
    text-align: left;
    color: var(--ink);
  }
  .ask h4 {
    margin: 0 0 0.8rem;
    padding-right: var(--corner-w, 2.5rem);
    font-size: 1.15rem;
    color: var(--ink);
  }
  .ask p {
    margin: 0 0 0.7rem;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--ink-soft);
  }
  .ask .key {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .ready {
    font-family: inherit;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--teal-ink);
  }
  .ready.warn {
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.1rem;
  }
  .actions button {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--teal-ink);
    font-size: 0.95rem;
    font-weight: 700;
  }
  .actions button.primary {
    background: var(--teal);
    border-color: var(--teal);
    color: var(--on-teal);
  }
  .actions button:disabled {
    opacity: 0.55;
  }
</style>
