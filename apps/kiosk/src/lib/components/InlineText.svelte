<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // Text edited where it is read. At rest the value renders as the card's own
  // typography (links clickable); a tap turns the very same block into a
  // textarea set in the same font, size and weight, so nothing jumps. The
  // field grows with its text, never scrolls inside itself, and gives the
  // block back on blur or Escape. The caller watches `value` and saves.
  import { createEventDispatcher, tick } from "svelte";
  import { linkify } from "$lib/linkify";

  export let value = "";
  export let placeholder = "";
  /** `title`: the card's headline; `body`: running text. */
  export let variant: "title" | "body" = "body";
  /** False renders the text only (a visitor, a foreign card). */
  export let editable = true;
  /** Enter commits a one-line field (the title); a body keeps its newlines. */
  export let singleLine = variant === "title";
  /** Open the field right away (a brand-new card asks for its title). */
  export let autofocus = false;
  export let ariaLabel = "";

  const dispatch = createEventDispatcher<{ commit: string }>();

  let editing = false;
  let area: HTMLTextAreaElement | null = null;

  export async function focus() {
    if (!editable) return;
    editing = true;
    await tick();
    area?.focus();
    fit();
  }

  function onTap(e: MouseEvent) {
    if (!editable) return;
    // A link inside the text is followed, not edited.
    if ((e.target as HTMLElement).closest("a")) return;
    void focus();
  }

  function fit() {
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${area.scrollHeight}px`;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // the field closes, not the card around it
      area?.blur();
    } else if (singleLine && e.key === "Enter") {
      e.preventDefault();
      area?.blur();
    }
  }

  function onBlur() {
    editing = false;
    if (singleLine) value = value.replace(/\s*\n\s*/g, " ");
    dispatch("commit", value);
  }

  $: if (autofocus && editable && !editing) void focus();
  $: if (editing) void tick().then(fit);
</script>

{#if editing}
  <textarea
    bind:this={area}
    class={variant}
    bind:value
    rows="1"
    {placeholder}
    aria-label={ariaLabel || placeholder}
    on:input={fit}
    on:keydown={onKey}
    on:blur={onBlur}
    enterkeyhint={singleLine ? "done" : "enter"}
  ></textarea>
{:else if value.trim()}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_tabindex -->
  <div
    class="{variant} text"
    class:editable
    role={editable ? "button" : undefined}
    tabindex={editable ? 0 : undefined}
    aria-label={editable ? ariaLabel || placeholder : undefined}
    on:click={onTap}
    on:keydown={(e) => e.key === "Enter" && editable && void focus()}
  >
    {@html linkify(value)}
  </div>
{:else if editable}
  <button type="button" class="{variant} empty" on:click={() => void focus()}
    >{placeholder}</button
  >
{/if}

<style>
  .text,
  textarea,
  .empty {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0.15rem 0.35rem;
    margin-left: -0.35rem;
    box-sizing: content-box;
    width: calc(100% - 0.7rem);
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ink);
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    font-family: inherit;
    resize: none;
    overflow: hidden;
    -webkit-user-select: text;
    user-select: text;
    transition: background 0.15s ease;
  }
  .text.editable,
  .empty {
    cursor: text;
  }
  /* Hover/focus hints the text is live, without turning it into a field. */
  @media (hover: hover) {
    .text.editable:hover {
      background: var(--ghost);
    }
  }
  .text.editable:focus-visible,
  textarea:focus {
    outline: none;
    background: var(--glass);
    box-shadow: inset 0 0 0 1.5px var(--teal);
  }
  .text :global(a) {
    color: var(--teal-ink);
    text-decoration: underline;
  }
  .text :global(a:active) {
    opacity: 0.7;
  }

  /* The two voices, shared by the rendered text and the field so a tap
     changes nothing but the caret. */
  .title {
    font-size: 1.55rem;
    line-height: 1.18;
    font-weight: 700;
    letter-spacing: -0.005em;
  }
  .body {
    font-size: 1rem;
    line-height: 1.55;
    font-weight: 500;
    color: var(--ink-soft);
  }
  textarea.body {
    color: var(--ink);
  }
  .empty {
    color: var(--muted);
    font-weight: 600;
  }
  .empty.title {
    font-weight: 700;
  }
  ::placeholder {
    color: var(--muted);
    font-weight: inherit;
  }
</style>
