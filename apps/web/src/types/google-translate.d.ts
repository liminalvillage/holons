declare global {
	interface Window {
		google: {
			translate: {
				TranslateElement: {
					new (options: {
						pageLanguage?: string;
						includedLanguages?: string;
						autoDisplay?: boolean;
						layout?: any;
					}, element: string): any;
					InlineLayout: {
						SIMPLE: any;
						HORIZONTAL: any;
						VERTICAL: any;
					};
				};
			};
		};
		harvestLanguageSetting?: string;
		triggerTranslation?: (language: string) => void;
		googleTranslateInitialized?: boolean;
		googleTranslateElementInit?: () => void;
	}
}

export {};

