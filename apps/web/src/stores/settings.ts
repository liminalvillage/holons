import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Settings interface matching the Settings component
export interface Settings {
  id: string | null;
  name: string;
  hex: string;
  version: number;
  timezone: string;
  language: string;
  theme: string;
  level: number;
  admin: string;
  roles: string[];
  values: string[];
  purpose: string;
  domains: string[];
  currencies: string[];
  maxTasks: number;
  users: any[];
}

// Default settings
export const defaultSettings: Settings = {
  id: null,
  name: '',
  hex: '',
  version: 1.0,
  timezone: '',
  language: 'en',
  theme: 'green',
  level: 1,
  admin: '',
  roles: [],
  values: [],
  purpose: '',
  domains: [],
  currencies: [],
  maxTasks: 13,
  users: []
};

// Create the main settings store
export const settingsStore = writable<Settings>(defaultSettings);

// Create a derived store specifically for the current language
export const currentLanguage = derived(
  settingsStore,
  ($settings) => $settings.language
);

// Create a derived store for when language changes
export const languageChanged = writable<string>('en');

// Language options that match Google Translate supported languages
export const supportedLanguages = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' }
];

// Helper functions for settings management
export const settingsHelpers = {
  // Update a specific setting
  updateSetting: (key: keyof Settings, value: any) => {
    settingsStore.update(settings => ({
      ...settings,
      [key]: value
    }));
    
    // If language changed, notify the language change store
    if (key === 'language') {
      languageChanged.set(value);
      console.log('Language setting changed to:', value);
    }
  },

  // Load settings from holosphere
  loadSettings: async (holosphere: any, holonId: string) => {
    try {
      if (!holosphere || !holonId) return;
      
      const data = await holosphere.getAll(holonId, 'settings');
      
      if (data && data[0]) {
        const loadedSettings = { ...defaultSettings, ...data[0], id: holonId };
        settingsStore.set(loadedSettings);
        console.log('Settings loaded from holosphere:', loadedSettings);
        
        // Trigger language change notification
        languageChanged.set(loadedSettings.language);
      } else {
        const newSettings = { ...defaultSettings, id: holonId };
        settingsStore.set(newSettings);
        console.log('Using default settings for holon:', holonId);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
    }
  },

  // Save settings to holosphere
  saveSettings: async (holosphere: any, holonId: string) => {
    try {
      if (!holosphere || !holonId) return;
      
      const settings = await new Promise<Settings>((resolve) => {
        settingsStore.subscribe(value => {
          resolve(value);
        })();
      });
      
      const settingsToSave = { ...settings, id: holonId };
      await holosphere.put(holonId, 'settings', settingsToSave);
      console.log('Settings saved to holosphere:', settingsToSave);
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  },

  // Get current language setting
  getCurrentLanguage: (): Promise<string> => {
    return new Promise((resolve) => {
      const unsubscribe = currentLanguage.subscribe(lang => {
        resolve(lang);
      });
      // Unsubscribe after the first value is received
      setTimeout(() => unsubscribe(), 0);
    });
  },

  // Check if a language is supported by Google Translate
  isSupportedLanguage: (langCode: string): boolean => {
    return supportedLanguages.some(lang => lang.code === langCode);
  },

  // Get language name from code
  getLanguageName: (langCode: string): string => {
    const lang = supportedLanguages.find(l => l.code === langCode);
    return lang ? lang.name : langCode;
  }
};

// Initialize language change detection in browser
if (browser) {
  // Listen for language changes and log them
  currentLanguage.subscribe((lang) => {
    console.log('Current language from store:', lang);
  });
  
  languageChanged.subscribe((lang) => {
    console.log('Language changed event:', lang);
    
    // Dispatch a custom event for Google Translate to listen to
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('settingsLanguageChanged', {
        detail: { language: lang }
      }));
    }
  });
}
