<template>
  <div class="flex flex-col min-h-screen">
     
    <header class="header">
      <nav-bar />
    </header>
    <main class="container flex-grow">
     <slot />
    </main>
    <g-footer />
    
  </div>
</template>


