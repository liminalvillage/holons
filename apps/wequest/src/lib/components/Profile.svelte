<script lang="ts">
  import Icon from "./Icon.svelte";
  import { iconForText } from "$lib/icons";
  import { profileUser, record, wallet, holonName, holonId, settingsHex } from "$lib/live";
  import { hexPickerOpen } from "$lib/stores";
  import { resolveUserId, resolveUsername, initials } from "$lib/config";
  import { telegramUser, login, logout } from "$lib/auth";

  const me = resolveUserId();
  const username = resolveUsername() || me || "guest";

  $: values = ($profileUser?.values ?? []) as string[];
  $: needs = ($profileUser?.needs ?? []) as string[];
</script>

<div class="scr">
  <div class="body" style="padding-bottom:96px">
    <div style="background:var(--color-accent-2-800);padding:56px 22px 26px;color:var(--color-neutral-100)">
      <div style="display:flex;align-items:center;gap:14px">
        <div
          style="width:66px;height:66px;border-radius:999px;background:var(--color-accent-2-400);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:24px;color:var(--color-accent-2-900)"
        >
          {initials(username)}
        </div>
        <div style="flex:1">
          <div style="font-family:var(--font-heading);font-size:25px">{username}</div>
          <div style="font-size:12.5px;color:var(--color-accent-2-300);margin-top:2px">
            Prosumer · {$holonName || $holonId}{$settingsHex ? ` · cell ${$settingsHex.slice(0, 7)}` : ""}
          </div>
        </div>
      </div>
      <div style="margin-top:20px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--color-accent-2-200);font-weight:700">
          <span>{$wallet.karma.toLocaleString()} karma</span>
          <span>{$wallet.standing}% of the holon's</span>
        </div>
        <div style="height:10px;border-radius:999px;background:rgba(245,234,216,.18);margin-top:8px;overflow:hidden">
          <div style="height:10px;width:{Math.min(100, $wallet.standing)}%;background:var(--color-accent)"></div>
        </div>
      </div>
    </div>
    <div style="padding:20px 20px 26px">
      <div
        style="display:flex;align-items:center;gap:12px;background:var(--color-surface);border-radius:var(--radius-lg);padding:14px 16px"
      >
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-heading);font-size:16px">Identity</div>
          <div style="font-size:12px;color:var(--color-neutral-600);margin-top:2px">
            {#if $telegramUser}
              Verified via Telegram · id {$telegramUser.id}
            {:else}
              Unverified device identity · id {me || "none"}
            {/if}
          </div>
        </div>
        {#if $telegramUser}
          <button
            class="tapp"
            on:click={logout}
            style="height:38px;padding:0 16px;border-radius:999px;border:1.5px solid var(--color-divider);font-weight:700;font-size:13px;flex:none"
          >
            Log out
          </button>
        {:else}
          <button
            class="tapp"
            on:click={login}
            style="height:38px;padding:0 16px;border-radius:999px;background:#2aabee;color:#fff;font-weight:700;font-size:13px;flex:none"
          >
            Log in
          </button>
        {/if}
      </div>

      <div
        style="display:flex;align-items:center;gap:12px;background:var(--color-surface);border-radius:var(--radius-lg);padding:14px 16px;margin-top:12px"
      >
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-heading);font-size:16px">Home hex</div>
          <div
            style="font-size:12px;color:var(--color-neutral-600);margin-top:2px;font-family:ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          >
            {$settingsHex ?? "not claimed yet"}
          </div>
        </div>
        <button
          class="tapp"
          on:click={() => hexPickerOpen.set(true)}
          style="height:38px;padding:0 16px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);font-family:var(--font-heading);font-size:13.5px;flex:none"
        >
          {$settingsHex ? "Change" : "Claim it"}
        </button>
      </div>

      {#if values.length || needs.length}
        <div style="font-family:var(--font-heading);font-size:19px;margin-top:24px">Values & needs</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
          {#each values as v (v)}
            <div class="chip" style="background:var(--color-accent-2-200);color:var(--color-accent-2-800)">{v}</div>
          {/each}
          {#each needs as n (n)}
            <div class="chip" style="background:var(--color-accent-200);color:var(--color-accent-800)">{n}</div>
          {/each}
        </div>
      {/if}

      <div style="font-family:var(--font-heading);font-size:19px;margin-top:26px">
        Your record
      </div>
      <div style="font-size:13px;color:var(--color-neutral-700);margin-top:4px;text-wrap:pretty">
        Every exchange you've made, permanently attached to you. This is the only CV that can't be
        written by hand.
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;margin-top:12px">
        {#each $record as c (c.id)}
          <div style="display:flex;gap:12px;padding:12px 2px;border-bottom:1px solid var(--color-divider)">
            <div style="width:34px;height:34px;border-radius:999px;background:var(--color-accent-2-200);display:flex;align-items:center;justify-content:center;flex:none">
              <Icon name={iconForText(String(c.title))} size={16} />
            </div>
            <div style="flex:1">
              <div style="font-size:13.5px;font-weight:700">{c.title}</div>
              <div style="font-size:11.5px;color:var(--color-neutral-600)">
                {c.created ? new Date(c.created).toLocaleDateString() : ""}
                {(c.participants?.length ?? 0) > 1 ? ` · with ${(c.participants.length - 1)} other${c.participants.length > 2 ? "s" : ""}` : ""}
              </div>
            </div>
          </div>
        {:else}
          <div style="padding:14px 2px;font-size:13px;color:var(--color-neutral-700)">
            No completed exchanges yet — fulfil a need and it becomes part of your record.
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
