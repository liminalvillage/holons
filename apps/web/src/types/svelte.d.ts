/// <reference types="svelte" />

declare namespace svelte.JSX {
  interface HTMLAttributes<T> {
    // Allow any attribute on HTML elements
    [name: string]: any;
  }
  
  interface SVGAttributes<T> {
    // Allow any attribute on SVG elements
    [name: string]: any;
  }
  
  interface DOMAttributes<T> {
    // Allow any attribute for DOM elements
    [name: string]: any;
  }
}

// Make svelteHTML compatible
declare namespace svelteHTML {
  interface HTMLAttributes<T> {
    [key: string]: any;
  }
  
  interface SVGAttributes<T> {
    [name: string]: any;
  }
  
  interface DOMAttributes<T> {
    [name: string]: any;
  }
}

// Fix module import errors
declare module "$app/environment" {
  export const browser: boolean;
  export const dev: boolean;
  export const building: boolean;
}

// Fix mapbox-gl module import error
declare module "mapbox-gl" {
  export default any;
} 