<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // Ask to join a holon: first its DNA, one gene at a time, then the request.
  // The walk is the same one the kiosk shows. This page only brings the
  // person's key and Telegram name to it; the request itself is core's
  // `applyToHolon` — it signs a kind-9021 carrying the DNA hash the person
  // agreed to, and refuses one that is not the holon's DNA as it is now.
  import { getContext, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import type { HoloSphere } from 'holosphere';
  import { applyToHolon } from '@holons/core/holons';
  import { signerFromSecretKey } from '@holons/core/holosphere';
  import { ID } from '../../../dashboard/store';
  import { nostrPrivateKey } from '$lib/stores/nostr';
  import { telegramUser } from '$lib/stores/telegram';
  import FrontData from '../../../components/dna/FrontData.svelte';
  import ApplyWalk from '../../../components/dna/ApplyWalk.svelte';

  const holosphere = getContext('holosphere') as HoloSphere | undefined;

  $: holonId = $page.params.id;
  $: if (holonId && holonId !== $ID) ID.set(holonId);
  onMount(() => {
    if (holonId) ID.set(holonId);
  });

  // `?dna=<hash>`: a handoff link, carrying the DNA version read elsewhere.
  $: handoff = $page.url.searchParams.get('dna');

  $: tg = $telegramUser as { id?: string | number; first_name?: string; username?: string } | null;
  $: defaultName = tg?.first_name || tg?.username || '';

  let data: FrontData | undefined;

  async function send(input: { acknowledged: string | null; reason: string }) {
    const sk = get(nostrPrivateKey);
    if (!holosphere || !sk) throw new Error('no signing key on this device');
    try {
      // A Telegram login names its Telegram id: the bot of a Telegram group
      // proves it from the key and links a member of the group at once.
      await applyToHolon(holosphere, holonId, signerFromSecretKey(sk), {
        acknowledged: input.acknowledged,
        reason: input.reason,
        telegramId: tg?.id,
        appName: (holosphere as unknown as { appname?: string }).appname,
      });
    } catch (err) {
      // The DNA moved while the person read: show the new one, then say so.
      if ((err as { name?: string })?.name === 'DnaChanged') await data?.reload();
      throw err;
    }
  }
</script>

<svelte:head>
  <title>Ask to join - {holonId}</title>
</svelte:head>

<FrontData holon={holonId} bind:this={data} let:front let:lang>
  <ApplyWalk {front} {lang} {handoff} {defaultName} canSign={!!$nostrPrivateKey} {send} />
</FrontData>
