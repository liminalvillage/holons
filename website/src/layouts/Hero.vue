<template>
  <div class="flex flex-col min-h-screen">
    <div>
      <slot name="hero" />
    </div>
    <div>
      <nav-bar />
      <main class="container flex-grow">
        <slot />
      </main>
    </div>
    <g-footer />
  </div>
</template>



