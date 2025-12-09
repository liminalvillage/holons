import { writable, derived, get } from 'svelte/store';

// Zircle configuration store
function createZircleStore() {
  const { subscribe, set, update } = writable({
    // Configuration
    usePercentSizes: true,
    mode: 'full',
    debug: false,

    // Style
    style: {
      theme: 'black',
      mode: 'dark'
    },

    // Navigation state
    currentView: null,
    viewHistory: [],
    params: {},

    // Views registry
    views: {},

    // Animation state
    isAnimating: false
  });

  return {
    subscribe,

    // Configure zircle
    config: (options) => update(state => {
      if (options.style) {
        state.style = { ...state.style, ...options.style };
      }
      if (options.usePercentSizes !== undefined) state.usePercentSizes = options.usePercentSizes;
      if (options.mode !== undefined) state.mode = options.mode;
      if (options.debug !== undefined) state.debug = options.debug;
      return state;
    }),

    // Navigate to a view
    toView: (viewNameOrConfig) => update(state => {
      let viewName, params = {};

      if (typeof viewNameOrConfig === 'string') {
        viewName = viewNameOrConfig;
      } else if (viewNameOrConfig && typeof viewNameOrConfig === 'object') {
        viewName = viewNameOrConfig.name;
        params = viewNameOrConfig.params || {};
      }

      if (viewName && viewName !== state.currentView) {
        state.viewHistory.push({ view: state.currentView, params: state.params });
        state.currentView = viewName;
        state.params = params;
        state.isAnimating = true;

        // Reset animation flag after transition
        setTimeout(() => {
          update(s => ({ ...s, isAnimating: false }));
        }, 500);
      }

      return state;
    }),

    // Go back to previous view
    goBack: () => update(state => {
      if (state.viewHistory.length > 0) {
        const previous = state.viewHistory.pop();
        state.currentView = previous.view;
        state.params = previous.params;
        state.isAnimating = true;

        setTimeout(() => {
          update(s => ({ ...s, isAnimating: false }));
        }, 500);
      }
      return state;
    }),

    // Get current params
    getParams: () => {
      const state = get({ subscribe });
      return state.params;
    },

    // Get current theme
    getTheme: () => {
      const state = get({ subscribe });
      return `theme-${state.style.theme}`;
    },

    // Get current theme mode
    getThemeMode: () => {
      const state = get({ subscribe });
      return `mode-${state.style.mode}`;
    },

    // Register a view
    registerView: (name, component) => update(state => {
      state.views[name] = component;
      return state;
    }),

    // Set params directly
    setParams: (params) => update(state => {
      state.params = { ...state.params, ...params };
      return state;
    }),

    // Reset to initial state
    reset: () => set({
      usePercentSizes: true,
      mode: 'full',
      debug: false,
      style: { theme: 'black', mode: 'dark' },
      currentView: null,
      viewHistory: [],
      params: {},
      views: {},
      isAnimating: false
    })
  };
}

export const zircle = createZircleStore();

// Derived stores for convenience
export const currentView = derived(zircle, $z => $z.currentView);
export const currentParams = derived(zircle, $z => $z.params);
export const theme = derived(zircle, $z => $z.style.theme);
export const themeMode = derived(zircle, $z => $z.style.mode);
export const isAnimating = derived(zircle, $z => $z.isAnimating);
