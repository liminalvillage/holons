<script lang="ts">
  import { go, flash } from "$lib/stores";
  import {
    selectedNeed,
    respondToSelected,
    claimResponse,
    confirmHandoffAs,
    handoffConfirms,
  } from "$lib/live";
  import { resolveUserId, initials } from "$lib/config";

  const me = resolveUserId();

  $: need = $selectedNeed;
  $: isForeign = Boolean(need?._federation?.origin || need?._hologram?.isHologram);
  $: isMine = !isForeign && String(need?.initiator?.id ?? "") === me;
  $: responses = need?.responses ?? [];
  $: open = need?.status === "requested" || need?.status === "offered";
  $: accepted = responses.find((r: any) => r.id === need?.claimedResponseId);
  $: iAmProvider = Boolean(accepted && String(accepted.responder?.id ?? "") === me);
  $: confirms = $handoffConfirms[String(need?.id ?? "")] ?? {};
  $: iConfirmedProvider = Boolean(confirms.providerAt || need?.handoff?.providerAt);

  let codeInput = "";
  let confirming = false;

  async function providerConfirm() {
    if (confirming) return;
    confirming = true;
    await confirmHandoffAs("provider", codeInput);
    confirming = false;
    codeInput = "";
  }

  let respondMessage = "";
  let respondPrice = "";
  let sending = false;

  async function send() {
    sending = true;
    const raw = String(respondPrice ?? "").trim();
    const price = raw === "" ? null : Number(raw);
    await respondToSelected(respondMessage.trim(), price != null && !Number.isNaN(price) ? price : null);
    sending = false;
    respondMessage = "";
    respondPrice = "";
  }

  async function accept(responseId: string) {
    if (!isMine) return;
    const ok = await claimResponse(responseId);
    if (ok) go("handoff");
  }

  function kindLabel(): string {
    const t = need?.item_type === "service" ? "time" : "a good";
    return `${t}${need?.category ? " · " + need.category : ""}`;
  }
</script>

{#if need}
  <div class="scr">
    <div style="padding:52px 20px 0">
      <button
        class="tapp"
        on:click={() => go("home")}
        style="width:44px;height:44px;border-radius:999px;background:var(--color-surface);display:flex;align-items:center;justify-content:center;font-size:18px"
      >
        ←
      </button>
    </div>
    <div class="body" style="padding:14px 20px 20px">
      <div class="chip" style="background:var(--color-accent-200);color:var(--color-accent-800)">
        {kindLabel()}
      </div>
      <div style="font-family:var(--font-heading);font-size:31px;line-height:1.08;margin-top:10px;text-wrap:pretty">
        {need.title}
      </div>
      <div style="font-size:13.5px;color:var(--color-neutral-700);margin-top:8px">
        {need.description ||
          (isForeign
            ? `Published by ${need._federation?.originName || need._federation?.origin || "a federated holon"}.`
            : "Published from your list to the ring.")}
      </div>

      <div style="display:flex;gap:10px;margin-top:18px">
        <div style="flex:1;background:var(--color-surface);border-radius:var(--radius-md);padding:12px 14px">
          <div style="font-family:var(--font-heading);font-size:22px;color:var(--color-accent-700)">
            {responses.length}
          </div>
          <div
            style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--color-neutral-600)"
          >
            answers
          </div>
        </div>
        <div style="flex:1;background:var(--color-surface);border-radius:var(--radius-md);padding:12px 14px">
          <div style="font-family:var(--font-heading);font-size:22px;text-transform:capitalize">{need.status}</div>
          <div
            style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--color-neutral-600)"
          >
            status
          </div>
        </div>
        <div style="flex:1;background:var(--color-surface);border-radius:var(--radius-md);padding:12px 14px">
          <div style="font-family:var(--font-heading);font-size:22px">
            {need.hex ? need.hex.slice(0, 5) + "…" : "—"}
          </div>
          <div
            style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--color-neutral-600)"
          >
            on the map
          </div>
        </div>
      </div>

      <div style="font-family:var(--font-heading);font-size:19px;margin-top:24px">Who answered</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        {#each responses as o (o.id)}
          <button
            class="tapp"
            on:click={() =>
              isMine && open
                ? accept(o.id)
                : flash(o.responder?.name ? `${o.responder.name} answered.` : "A provider answered.")}
            style="background:{need.claimedResponseId === o.id
              ? 'var(--color-accent-2-200)'
              : 'var(--color-surface)'};border:1.5px solid {need.claimedResponseId === o.id
              ? 'var(--color-accent-2-500)'
              : 'transparent'};border-radius:var(--radius-md);padding:14px;display:flex;gap:12px;align-items:center;width:100%"
          >
            <div
              style="width:42px;height:42px;border-radius:999px;background:var(--color-accent-2-300);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:15px;color:var(--color-accent-2-800);flex:none"
            >
              {initials(String(o.responder?.name ?? o.responder?.id ?? "?"))}
            </div>
            <div style="flex:1;min-width:0;text-align:left">
              <div style="font-weight:700;font-size:14.5px">{o.responder?.name ?? o.responder?.id}</div>
              <div style="font-size:12px;color:var(--color-neutral-700);margin-top:2px">
                {o.message || "Can provide."}
              </div>
            </div>
            <div style="text-align:right;flex:none">
              {#if o.price != null}
                <div style="font-size:13px;font-weight:700">{o.price} {o.currency ?? "h"}</div>
              {/if}
              <div style="font-size:11px;color:var(--color-neutral-600)">
                {isMine && open ? "tap to accept" : ""}
              </div>
            </div>
          </button>
        {:else}
          <div
            style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px;font-size:13px;color:var(--color-neutral-700)"
          >
            No answers yet — the need is live on the ring.
          </div>
        {/each}
      </div>

      {#if !isMine && open}
        <div style="font-family:var(--font-heading);font-size:19px;margin-top:24px">Answer this need</div>
        <form on:submit|preventDefault={send} style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <textarea
            bind:value={respondMessage}
            rows="2"
            placeholder="What can you provide, and when?"
            style="width:100%;border-radius:var(--radius-md);border:1.5px solid var(--color-divider);background:var(--color-surface);padding:12px 14px;font:inherit;font-size:14px;resize:vertical"
          ></textarea>
          <div style="display:flex;gap:10px">
            <input
              type="number"
              step="any"
              min="0"
              bind:value={respondPrice}
              placeholder="Hours (optional)"
              style="flex:1;height:48px;border-radius:999px;border:1.5px solid var(--color-divider);background:var(--color-surface);padding:0 16px;font:inherit;font-size:14px"
            />
            <button
              type="submit"
              class="tapp"
              disabled={sending || (!respondMessage.trim() && String(respondPrice ?? "").trim() === "")}
              style="flex:1;height:48px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:15px"
            >
              {sending ? "Sending…" : "Send answer"}
            </button>
          </div>
        </form>
      {/if}

      {#if isMine && need.status === "claimed"}
        <button
          class="tapp"
          on:click={() => go("handoff")}
          style="width:100%;margin-top:20px;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px"
        >
          Show the handoff code
        </button>
      {/if}

      {#if iAmProvider && need.status === "claimed"}
        <div style="margin-top:22px;background:var(--color-accent-2-200);border-radius:var(--radius-lg);padding:18px">
          <div style="font-family:var(--font-heading);font-size:18px;color:var(--color-accent-2-900)">
            You're the provider
          </div>
          {#if iConfirmedProvider}
            <div style="font-size:13px;color:var(--color-accent-2-800);margin-top:6px">
              Code accepted — the hours move as soon as the requester confirms.
            </div>
          {:else}
            <div style="font-size:13px;color:var(--color-accent-2-800);margin-top:6px;text-wrap:pretty">
              At the handoff, type in the three-letter code on their screen. That's your side of
              the confirmation.
            </div>
            <form
              on:submit|preventDefault={providerConfirm}
              style="display:flex;gap:10px;margin-top:12px"
            >
              <input
                bind:value={codeInput}
                maxlength="3"
                placeholder="K7Q"
                autocapitalize="characters"
                style="width:96px;height:48px;border-radius:var(--radius-md);border:none;text-align:center;font-family:var(--font-heading);font-size:20px;letter-spacing:.2em;background:#f5ead8;color:var(--color-text);text-transform:uppercase"
              />
              <button
                type="submit"
                class="tapp"
                disabled={confirming || codeInput.trim().length < 3}
                style="flex:1;height:48px;border-radius:999px;background:var(--color-accent-2-700);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:15px"
              >
                {confirming ? "Confirming…" : "Tap the code in"}
              </button>
            </form>
          {/if}
        </div>
      {/if}
      <div style="text-align:center;font-size:11.5px;color:var(--color-neutral-600);margin-top:10px">
        Hours move only when both of you confirm the handoff.
      </div>
    </div>
  </div>
{/if}
