/// <reference types="vite/client" />

// Define vite/client module
declare module 'vite/client' {
  interface ImportMeta {
    hot: any;
    env: Record<string, string>;
  }
} 