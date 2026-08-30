// Google Translate widget bootstrap. Loaded synchronously from app.html so
// the global `googleTranslateElementInit` callback exists when the
// element.js script (loaded async right after) fires.

// Global variable to store current language setting
window.holonsLanguageSetting = 'en';

// Track retry attempts to avoid infinite loops
window.googleTranslateRetryCount = 0;
window.googleTranslateMaxRetries = 30; // Wait up to 30 seconds for element

function googleTranslateElementInit() {
	// Wait for DOM to be ready
	if (document.readyState !== 'complete') {
		window.addEventListener('load', googleTranslateElementInit);
		return;
	}

	// Check if google translate is available
	if (typeof google === 'undefined' || !google.translate) {
		// Try to reload the script silently
		setTimeout(() => {
			const script = document.createElement('script');
			script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
			script.async = true;
			document.head.appendChild(script);
		}, 2000);
		return;
	}

	// Check if target element exists in TopBar
	let targetElement = document.getElementById('google_translate_element');
	if (!targetElement) {
		window.googleTranslateRetryCount++;
		if (window.googleTranslateRetryCount < window.googleTranslateMaxRetries) {
			// Element not found - silently retry
			setTimeout(googleTranslateElementInit, 1000);
		}
		return;
	}

	// Reset retry count on success
	window.googleTranslateRetryCount = 0;

	try {
		new google.translate.TranslateElement({
			pageLanguage: 'auto',
			includedLanguages: 'es,fr,de,en,ja,zh-CN,it,pt,ru,ar,ko,nl,pl,sv,da,no,fi,hu,cs,sk,sl,hr,bs,sr,me,mk,bg,ro,el,tr,he,fa,ur,hi,th,vi,id,ms,fil,tl,km,lo,my,ne,si,ta,te,kn,ml,gu,pa,or,as,bn,mr',
			autoDisplay: false,
			layout: google.translate.TranslateElement.InlineLayout.SIMPLE
		}, 'google_translate_element');

		// Mark as initialized
		window.googleTranslateInitialized = true;

		// Monitor for repositioning and force it back to TopBar if moved
		const observer = new MutationObserver(() => {
			const currentElement = document.getElementById('google_translate_element');
			if (currentElement && !currentElement.closest('.top-bar-container')) {
				// Find the TopBar right side controls container
				const topBarRightControls = document.querySelector('.top-bar-container .hidden.sm\\:flex');
				if (topBarRightControls) {
					// Remove from current location
					currentElement.remove();
					// Create new element in TopBar
					const newElement = document.createElement('div');
					newElement.id = 'google_translate_element';
					topBarRightControls.insertBefore(newElement, topBarRightControls.firstChild);
					// Reinitialize Google Translate on the new element
					setTimeout(() => {
						new google.translate.TranslateElement({
							pageLanguage: 'auto',
							includedLanguages: 'es,fr,de,en,ja,zh-CN,it,pt,ru,ar,ko,nl,pl,sv,da,no,fi,hu,cs,sk,sl,hr,bs,sr,me,mk,bg,ro,el,tr,he,fa,ur,hi,th,vi,id,ms,fil,tl,km,lo,my,ne,si,ta,te,kn,ml,gu,pa,or,as,bn,mr',
							autoDisplay: false,
							layout: google.translate.TranslateElement.InlineLayout.SIMPLE
						}, 'google_translate_element');
					}, 100);
				}
			}
		});

		// Start observing
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		// Function to trigger translation to a specific language
		window.triggerTranslation = function(targetLang) {
			// Look for the Google Translate combo
			const selectElement = document.querySelector('.goog-te-combo') ||
								document.querySelector('select[class*="goog-te"]') ||
								document.querySelector('#google_translate_element select');

			if (selectElement) {
				// Map language codes to Google Translate codes
				const langMap = {
					'zh': 'zh-CN', // Chinese (Simplified)
					'fil': 'tl',   // Filipino -> Tagalog
					'en': ''       // English (original)
				};
				const googleLang = targetLang === 'en' ? '' : (langMap[targetLang] || targetLang);

				// Only trigger if language is different from current
				if (selectElement.value !== googleLang) {
					selectElement.value = googleLang;
					selectElement.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		};

		// Listen for settings language changes
		window.addEventListener('settingsLanguageChanged', (event) => {
			const newLanguage = event.detail.language;
			window.holonsLanguageSetting = newLanguage;

			if (newLanguage && newLanguage !== 'en') {
				window.triggerTranslation(newLanguage);
			} else if (newLanguage === 'en') {
				// Reset to original language (English)
				const selectElement = document.querySelector('.goog-te-combo');
				if (selectElement && selectElement.value !== '') {
					selectElement.value = '';
					selectElement.dispatchEvent(new Event('change'));
				}
			}
		});

		// Also listen for direct flag selector changes
		window.addEventListener('flagLanguageChanged', (event) => {
			const newLanguage = event.detail.language;

			if (newLanguage && newLanguage !== 'en') {
				window.triggerTranslation(newLanguage);
			} else if (newLanguage === 'en') {
				const selectElement = document.querySelector('.goog-te-combo');
				if (selectElement && selectElement.value !== '') {
					selectElement.value = '';
					selectElement.dispatchEvent(new Event('change'));
				}
			}
		});

		// Automatic browser language detection and translation
		const browserLang = (navigator.language || navigator.userLanguage || navigator.browserLanguage || 'en').split('-')[0].toLowerCase();
		const browserLanguages = navigator.languages || [navigator.language];

		// Extended supported languages list
		const supportedLangs = {
			'es': 'es', 'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt',
			'ru': 'ru', 'ja': 'ja', 'ko': 'ko', 'zh': 'zh-CN', 'ar': 'ar',
			'nl': 'nl', 'pl': 'pl', 'sv': 'sv', 'da': 'da', 'no': 'no',
			'fi': 'fi', 'hu': 'hu', 'cs': 'cs', 'sk': 'sk', 'hi': 'hi',
			'th': 'th', 'vi': 'vi', 'tr': 'tr', 'he': 'he', 'el': 'el',
			'bg': 'bg', 'ro': 'ro', 'hr': 'hr', 'sl': 'sl', 'id': 'id',
			'ms': 'ms', 'tl': 'tl', 'fil': 'tl'
		};

		let targetLang = null;

		// First try saved setting, then browser language
		if (window.holonsLanguageSetting && window.holonsLanguageSetting !== 'en') {
			targetLang = window.holonsLanguageSetting;
		} else if (supportedLangs[browserLang]) {
			targetLang = supportedLangs[browserLang];
		} else {
			for (let lang of browserLanguages) {
				const langCode = lang.split('-')[0].toLowerCase();
				if (supportedLangs[langCode]) {
					targetLang = supportedLangs[langCode];
					break;
				}
			}
		}

		// Trigger translation if we found a supported language
		if (targetLang && targetLang !== 'en') {
			window.holonsLanguageSetting = targetLang;
			window.triggerTranslation(targetLang);
		}

	} catch (error) {
		console.error('Error creating Google Translate element:', error);
	}
}

// Expose for the element.js script callback
window.googleTranslateElementInit = googleTranslateElementInit;
