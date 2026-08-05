<script lang="ts">
  import { resolveAppName, resolveUserId, resolveUsername } from "$lib/config";
  import { setHolon, setUser } from "$lib/config";
  import { login } from "$lib/auth";

  let holon = "";
  let user = "";
  let username = "";
  let manualIdentity = false;

  // A Telegram session (or dev override) may already provide the identity —
  // then only the holon is missing.
  const knownUser = resolveUserId();
  const knownName = resolveUsername();

  function start() {
    if (!holon.trim()) return;
    if (!knownUser && !user.trim()) return;
    setHolon(holon);
    if (!knownUser) setUser(user, username || user);
    location.reload();
  }
</script>

<div class="scr" style="background:var(--color-accent-2-800)">
  <div class="body" style="padding:70px 26px 30px;display:flex;flex-direction:column">
    <div
      style="font-family:var(--font-heading);font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:var(--color-accent-300)"
    >
      WΞQUEST
    </div>
    <div style="font-family:var(--font-heading);font-size:32px;line-height:1.08;color:var(--color-neutral-100);margin-top:14px">
      Point me at a holon
    </div>
    <div style="font-size:14px;color:var(--color-accent-2-300);margin-top:10px;text-wrap:pretty">
      Everything here reads and writes the live Holosphere graph. Choose the holon that is your
      neighbourhood, and who you are acting as. (Namespace: {resolveAppName()} — override with
      <code>?app=</code>.)
    </div>
    <label style="margin-top:26px;font-size:12px;font-weight:700;color:var(--color-accent-2-200)">
      Holon id
      <input
        bind:value={holon}
        placeholder="e.g. -1001234567890 or an H3 cell"
        style="width:100%;margin-top:6px;height:48px;border-radius:999px;border:none;padding:0 18px;font:inherit;background:#f5ead8;color:var(--color-text)"
      />
    </label>

    {#if knownUser}
      <div
        style="margin-top:14px;background:rgba(245,234,216,.1);border-radius:var(--radius-lg);padding:14px 16px;font-size:13px;color:var(--color-accent-2-200)"
      >
        Acting as <strong style="color:var(--color-neutral-100)">{knownName || knownUser}</strong>
      </div>
    {:else}
      <button
        class="tapp"
        on:click={login}
        style="margin-top:14px;height:52px;border-radius:999px;background:#2aabee;color:#fff;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:15px"
      >
        ➤ Log in with Telegram
      </button>
      <button
        class="tapp"
        on:click={() => (manualIdentity = !manualIdentity)}
        style="margin-top:10px;height:36px;display:flex;align-items:center;justify-content:center;font-size:12.5px;color:var(--color-accent-2-300)"
      >
        {manualIdentity ? "Hide manual identity" : "…or enter an id manually (dev)"}
      </button>
      {#if manualIdentity}
        <label style="margin-top:6px;font-size:12px;font-weight:700;color:var(--color-accent-2-200)">
          Your user id
          <input
            bind:value={user}
            placeholder="e.g. your Telegram id"
            style="width:100%;margin-top:6px;height:48px;border-radius:999px;border:none;padding:0 18px;font:inherit;background:#f5ead8;color:var(--color-text)"
          />
        </label>
        <label style="margin-top:14px;font-size:12px;font-weight:700;color:var(--color-accent-2-200)">
          Display name (optional)
          <input
            bind:value={username}
            placeholder="Roberto"
            style="width:100%;margin-top:6px;height:48px;border-radius:999px;border:none;padding:0 18px;font:inherit;background:#f5ead8;color:var(--color-text)"
          />
        </label>
      {/if}
    {/if}

    <div style="flex:1"></div>
    <button
      class="tapp"
      on:click={start}
      disabled={!holon.trim() || (!knownUser && !user.trim())}
      style="width:100%;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px;opacity:{holon.trim() &&
      (knownUser || user.trim())
        ? 1
        : 0.5}"
    >
      Enter the ring
    </button>
  </div>
</div>
