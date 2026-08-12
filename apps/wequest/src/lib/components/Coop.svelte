<script lang="ts">
  import { go } from "$lib/stores";
  import {
    holonName,
    holonId,
    members,
    demandBars,
    proposals,
    proposalTallies,
    hoursCirculated,
    treasury,
    treasuryRate,
    myDelegate,
    partners,
    voteOnProposal,
    createProposal,
    delegateVoteTo,
    revokeDelegation,
    executeSelectedProposal,
  } from "$lib/live";
  import { resolveUserId } from "$lib/config";

  const me = resolveUserId();

  let composing = false;
  let proposalTitle = "";
  let proposalBody = "";
  let proposalHours = "";
  let proposalRate = "";
  let submitting = false;

  async function submitProposal() {
    if (submitting || !proposalTitle.trim()) return;
    submitting = true;
    const hours = Number(proposalHours);
    const rate = Number(proposalRate);
    const ok = await createProposal(proposalTitle, proposalBody, {
      ...(Number.isFinite(hours) && hours > 0 ? { requestedHours: hours } : {}),
      ...(proposalRate.trim() !== "" && Number.isFinite(rate)
        ? { newTreasuryRate: rate / 100 }
        : {}),
    });
    submitting = false;
    if (ok) {
      composing = false;
      proposalTitle = "";
      proposalBody = "";
      proposalHours = "";
      proposalRate = "";
    }
  }

  let executingId: string | null = null;
  async function execute(p: any) {
    if (executingId) return;
    executingId = String(p.id);
    await executeSelectedProposal(p);
    executingId = null;
  }

  let delegateTo = "";
  let delegating = false;
  async function delegate() {
    if (delegating || !delegateTo) return;
    delegating = true;
    await delegateVoteTo(delegateTo);
    delegating = false;
    delegateTo = "";
  }

  $: maxDemand = Math.max(1, ...$demandBars.map(([, n]) => n));
  $: others = $members.filter((m: any) => String(m.id) !== me);
  $: myDelegateUser = $members.find(
    (m: any) => String(m.id) === String($myDelegate ?? ""),
  );
  $: myDelegateName =
    myDelegateUser?.username ??
    myDelegateUser?.first_name ??
    ($myDelegate ? String($myDelegate).slice(0, 8) : "");

  function iVoted(p: any): boolean {
    return (p.participants ?? []).some((x: any) => String(x?.id) === me);
  }
</script>

<div class="scr">
  <div style="padding:52px 20px 18px;background:var(--color-accent-2-200)">
    <button
      class="tapp"
      on:click={() => go("home")}
      style="width:44px;height:44px;border-radius:999px;background:rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:14px"
    >
      ←
    </button>
    <div
      style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-accent-2-700);font-weight:700"
    >
      One need · one coop · worldwide
    </div>
    <div style="font-family:var(--font-heading);font-size:34px;line-height:1.05;margin-top:5px;color:var(--color-accent-2-900)">
      {$holonName || $holonId}
    </div>
    <div style="font-size:13.5px;color:var(--color-accent-2-800);margin-top:7px;text-wrap:pretty">
      {$members.length} member{$members.length === 1 ? "" : "s"} · federated with {$partners.length}
      holon{$partners.length === 1 ? "" : "s"}. Everyone asking here is asking together.
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <div class="chip" style="background:var(--color-accent-2-700);color:var(--color-neutral-100)">
        You're a prosumer
      </div>
      <div class="chip" style="background:rgba(255,255,255,.55);color:var(--color-accent-2-800)">
        acting as {me || "guest"}
      </div>
    </div>
  </div>
  <div class="body" style="padding:20px 20px 116px">
    <div style="font-family:var(--font-heading);font-size:19px">Demand in your rings, live</div>
    {#if $demandBars.length}
      <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:14px">
        {#each $demandBars as [label, n], i (label)}
          <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:120px;gap:5px">
            <div
              style="border-radius:6px 6px 3px 3px;background:{i === 0
                ? 'var(--color-accent)'
                : i < 3
                  ? 'var(--color-accent-400)'
                  : 'var(--color-accent-2-400)'};height:{((n / maxDemand) * 100 + 8).toFixed(0)}px"
            ></div>
            <div
              style="font-size:9px;text-align:center;color:var(--color-neutral-600);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            >
              {label}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div style="margin-top:12px;background:var(--color-surface);border-radius:var(--radius-md);padding:14px;font-size:13px;color:var(--color-neutral-700)">
        No open needs anywhere in the rings — the quiet list.
      </div>
    {/if}

    <div style="display:flex;gap:10px;margin-top:22px">
      <div style="flex:1;background:var(--color-surface);border-radius:var(--radius-md);padding:14px">
        <div style="font-family:var(--font-heading);font-size:23px">{$hoursCirculated.toFixed(1)} h</div>
        <div style="font-size:11px;color:var(--color-neutral-600);font-weight:600">in circulation</div>
      </div>
      <div style="flex:1;background:var(--color-surface);border-radius:var(--radius-md);padding:14px">
        <div style="font-family:var(--font-heading);font-size:23px">{$members.length}</div>
        <div style="font-size:11px;color:var(--color-neutral-600);font-weight:600">members</div>
      </div>
      <div style="flex:1;background:var(--color-accent-2-800);border-radius:var(--radius-md);padding:14px;color:var(--color-neutral-100)">
        <div style="font-family:var(--font-heading);font-size:23px">{$treasury.toFixed(1)} h</div>
        <div style="font-size:11px;color:var(--color-accent-2-300);font-weight:600">
          treasury · {Math.round($treasuryRate * 100)}% share
        </div>
      </div>
    </div>

    <div style="font-family:var(--font-heading);font-size:19px;margin-top:24px">What the coop is deciding</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      {#each $proposals as p (p.id)}
        {@const t = $proposalTallies[String(p.id)]}
        {@const executed = p.status === "executed"}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:15px 16px">
          <div style="display:flex;align-items:baseline;gap:8px">
            <div style="font-weight:700;font-size:14.5px;text-wrap:pretty;flex:1">{p.title}</div>
            {#if executed}
              <div class="chip" style="background:var(--color-accent-2-200);color:var(--color-accent-2-800);flex:none">✓ executed</div>
            {:else if t?.passed}
              <div class="chip" style="background:var(--color-accent-200);color:var(--color-accent-800);flex:none">passing</div>
            {/if}
          </div>
          {#if p.description}
            <div style="font-size:12.5px;color:var(--color-neutral-700);margin-top:4px">{p.description}</div>
          {/if}
          {#if p.requestedHours || p.newTreasuryRate != null}
            <div style="font-size:12px;color:var(--color-accent-2-800);font-weight:700;margin-top:6px">
              {#if p.requestedHours}{Number(p.requestedHours).toFixed(1)} h from the treasury{/if}
              {#if p.requestedHours && p.newTreasuryRate != null}&nbsp;·&nbsp;{/if}
              {#if p.newTreasuryRate != null}coop share → {Math.round(Number(p.newTreasuryRate) * 100)}%{/if}
            </div>
          {/if}
          <div style="height:8px;border-radius:999px;background:var(--color-neutral-300);margin-top:12px;overflow:hidden">
            <div
              style="height:8px;background:var(--color-accent-2-600);width:{Math.min(100, Math.round((t?.ratio ?? 0) * 100))}%"
            ></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--color-neutral-600);font-weight:700;margin-top:6px">
            <span>{t?.yes ?? 0} of {t?.total ?? 0} weight says yes</span>
            <span>passes past half{t?.delegated ? ` · ${t.delegated} delegated` : ""}</span>
          </div>
          {#if !executed}
            <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
              <button
                class="tapp"
                on:click={() => voteOnProposal(p)}
                style="flex:1;height:40px;border-radius:999px;background:{iVoted(p)
                  ? 'var(--color-neutral-400)'
                  : 'var(--color-accent-2-700)'};color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px"
              >
                {iVoted(p) ? "Withdraw vote" : "Vote yes"}
              </button>
              {#if t?.passed}
                <button
                  class="tapp"
                  on:click={() => execute(p)}
                  disabled={executingId != null}
                  style="flex:1;height:40px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px"
                >
                  {executingId === String(p.id) ? "Executing…" : "Execute"}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px;font-size:13px;color:var(--color-neutral-700)">
          Nothing on the table — put the first proposal up for a vote below.
        </div>
      {/each}

      {#if composing}
        <form
          on:submit|preventDefault={submitProposal}
          style="background:var(--color-surface);border-radius:var(--radius-md);padding:15px 16px;display:flex;flex-direction:column;gap:10px"
        >
          <input
            bind:value={proposalTitle}
            placeholder="What should the coop decide?"
            style="width:100%;height:44px;border-radius:var(--radius-md);border:1.5px solid var(--color-divider);background:var(--color-bg);padding:0 14px;font:inherit;font-size:14px"
          />
          <textarea
            bind:value={proposalBody}
            rows="2"
            placeholder="Why, in a sentence or two (optional)"
            style="width:100%;border-radius:var(--radius-md);border:1.5px solid var(--color-divider);background:var(--color-bg);padding:10px 14px;font:inherit;font-size:13.5px;resize:vertical"
          ></textarea>
          <div style="display:flex;gap:8px">
            <input
              type="number"
              step="any"
              min="0"
              bind:value={proposalHours}
              placeholder="Hours from the treasury"
              style="flex:1;height:44px;border-radius:var(--radius-md);border:1.5px solid var(--color-divider);background:var(--color-bg);padding:0 14px;font:inherit;font-size:13px;min-width:0"
            />
            <input
              type="number"
              step="any"
              min="0"
              max="50"
              bind:value={proposalRate}
              placeholder="Coop share %"
              style="flex:1;height:44px;border-radius:var(--radius-md);border:1.5px solid var(--color-divider);background:var(--color-bg);padding:0 14px;font:inherit;font-size:13px;min-width:0"
            />
          </div>
          <div style="display:flex;gap:8px">
            <button
              type="button"
              class="tapp"
              on:click={() => (composing = false)}
              style="flex:1;height:42px;border-radius:999px;border:1.5px solid var(--color-neutral-400);color:var(--color-neutral-700);background:transparent;font-weight:700;font-size:13px"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="tapp"
              disabled={submitting || !proposalTitle.trim()}
              style="flex:2;height:42px;border-radius:999px;background:var(--color-accent-2-700);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px"
            >
              {submitting ? "Publishing…" : "Put it on the table"}
            </button>
          </div>
        </form>
      {:else}
        <button
          class="tapp"
          on:click={() => (composing = true)}
          style="height:48px;border-radius:var(--radius-md);border:1.5px dashed var(--color-neutral-400);display:flex;align-items:center;justify-content:center;gap:8px;color:var(--color-neutral-700);font-weight:700;font-size:13.5px"
        >
          + Propose something
        </button>
      {/if}
    </div>

    <div style="margin-top:22px;background:var(--color-surface);border-radius:var(--radius-lg);padding:18px">
      <div style="font-family:var(--font-heading);font-size:18px">Your vote</div>
      {#if $myDelegate}
        <div style="font-size:13px;color:var(--color-neutral-700);margin-top:6px;text-wrap:pretty">
          Delegated to <strong>{myDelegateName}</strong> — your weight follows their vote, and
          theirs onward, until you take it back. Voting directly on a proposal always overrides it.
        </div>
        <button
          class="tapp"
          on:click={revokeDelegation}
          style="margin-top:12px;height:42px;padding:0 18px;border-radius:999px;border:1.5px solid var(--color-neutral-400);color:var(--color-neutral-700);background:transparent;font-weight:700;font-size:13px"
        >
          Take my vote back
        </button>
      {:else}
        <div style="font-size:13px;color:var(--color-neutral-700);margin-top:6px;text-wrap:pretty">
          You vote directly. Or hand your weight to someone you trust — they can pass it on, and
          you can take it back any time. Weight is reputation: stars earned on settled exchanges.
        </div>
        {#if others.length}
          <div style="display:flex;gap:8px;margin-top:12px">
            <select
              bind:value={delegateTo}
              style="flex:1;height:44px;border-radius:999px;border:1.5px solid var(--color-divider);background:var(--color-bg);padding:0 14px;font:inherit;font-size:13.5px;min-width:0"
            >
              <option value="" disabled>Delegate to…</option>
              {#each others as m (m.id)}
                <option value={String(m.id)}>{m.username ?? m.first_name ?? m.id}</option>
              {/each}
            </select>
            <button
              class="tapp"
              on:click={delegate}
              disabled={delegating || !delegateTo}
              style="height:44px;padding:0 18px;border-radius:999px;background:var(--color-accent-2-700);color:var(--color-neutral-100);font-weight:700;font-size:13px;flex:none"
            >
              {delegating ? "Delegating…" : "Delegate"}
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <div style="margin-top:22px;background:var(--color-accent-200);border-radius:var(--radius-lg);padding:18px">
      <div style="font-family:var(--font-heading);font-size:18px;color:var(--color-accent-800)">
        Federation exchanges
      </div>
      <div style="font-size:12.5px;color:var(--color-accent-800);margin-top:5px;text-wrap:pretty">
        This holon settles needs and offers with its federated partners. You don't have to arrange
        anything.
      </div>
      <button
        class="tapp"
        on:click={() => go("barter")}
        style="margin-top:12px;font-size:13px;font-weight:700;color:var(--color-accent-800)"
      >
        See the partners →
      </button>
    </div>
  </div>
</div>
