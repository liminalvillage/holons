
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/ical-proxy" | "/api/telegram" | "/api/telegram/send-key" | "/badges-demo" | "/demo" | "/global" | "/navigator" | "/qr-demo" | "/qr" | "/qr/test" | "/sdgs" | "/sdgs/[sdg]" | "/[id]" | "/[id]/badges" | "/[id]/calendar" | "/[id]/calendar/feed.ics" | "/[id]/card-generator" | "/[id]/checklists" | "/[id]/contracts" | "/[id]/council" | "/[id]/dashboard" | "/[id]/db" | "/[id]/dna" | "/[id]/documentation" | "/[id]/documentation/dashboard" | "/[id]/events" | "/[id]/expenses" | "/[id]/federation" | "/[id]/flow" | "/[id]/global-holons" | "/[id]/holons" | "/[id]/library" | "/[id]/map" | "/[id]/navigator" | "/[id]/offers" | "/[id]/orbits" | "/[id]/proposals" | "/[id]/questionnaires" | "/[id]/roles" | "/[id]/schedule" | "/[id]/settings" | "/[id]/shopping" | "/[id]/statistics" | "/[id]/status" | "/[id]/tags" | "/[id]/tasks";
		RouteParams(): {
			"/sdgs/[sdg]": { sdg: string };
			"/[id]": { id: string };
			"/[id]/badges": { id: string };
			"/[id]/calendar": { id: string };
			"/[id]/calendar/feed.ics": { id: string };
			"/[id]/card-generator": { id: string };
			"/[id]/checklists": { id: string };
			"/[id]/contracts": { id: string };
			"/[id]/council": { id: string };
			"/[id]/dashboard": { id: string };
			"/[id]/db": { id: string };
			"/[id]/dna": { id: string };
			"/[id]/documentation": { id: string };
			"/[id]/documentation/dashboard": { id: string };
			"/[id]/events": { id: string };
			"/[id]/expenses": { id: string };
			"/[id]/federation": { id: string };
			"/[id]/flow": { id: string };
			"/[id]/global-holons": { id: string };
			"/[id]/holons": { id: string };
			"/[id]/library": { id: string };
			"/[id]/map": { id: string };
			"/[id]/navigator": { id: string };
			"/[id]/offers": { id: string };
			"/[id]/orbits": { id: string };
			"/[id]/proposals": { id: string };
			"/[id]/questionnaires": { id: string };
			"/[id]/roles": { id: string };
			"/[id]/schedule": { id: string };
			"/[id]/settings": { id: string };
			"/[id]/shopping": { id: string };
			"/[id]/statistics": { id: string };
			"/[id]/status": { id: string };
			"/[id]/tags": { id: string };
			"/[id]/tasks": { id: string }
		};
		LayoutParams(): {
			"/": { sdg?: string; id?: string };
			"/api": Record<string, never>;
			"/api/ical-proxy": Record<string, never>;
			"/api/telegram": Record<string, never>;
			"/api/telegram/send-key": Record<string, never>;
			"/badges-demo": Record<string, never>;
			"/demo": Record<string, never>;
			"/global": Record<string, never>;
			"/navigator": Record<string, never>;
			"/qr-demo": Record<string, never>;
			"/qr": Record<string, never>;
			"/qr/test": Record<string, never>;
			"/sdgs": { sdg?: string };
			"/sdgs/[sdg]": { sdg: string };
			"/[id]": { id: string };
			"/[id]/badges": { id: string };
			"/[id]/calendar": { id: string };
			"/[id]/calendar/feed.ics": { id: string };
			"/[id]/card-generator": { id: string };
			"/[id]/checklists": { id: string };
			"/[id]/contracts": { id: string };
			"/[id]/council": { id: string };
			"/[id]/dashboard": { id: string };
			"/[id]/db": { id: string };
			"/[id]/dna": { id: string };
			"/[id]/documentation": { id: string };
			"/[id]/documentation/dashboard": { id: string };
			"/[id]/events": { id: string };
			"/[id]/expenses": { id: string };
			"/[id]/federation": { id: string };
			"/[id]/flow": { id: string };
			"/[id]/global-holons": { id: string };
			"/[id]/holons": { id: string };
			"/[id]/library": { id: string };
			"/[id]/map": { id: string };
			"/[id]/navigator": { id: string };
			"/[id]/offers": { id: string };
			"/[id]/orbits": { id: string };
			"/[id]/proposals": { id: string };
			"/[id]/questionnaires": { id: string };
			"/[id]/roles": { id: string };
			"/[id]/schedule": { id: string };
			"/[id]/settings": { id: string };
			"/[id]/shopping": { id: string };
			"/[id]/statistics": { id: string };
			"/[id]/status": { id: string };
			"/[id]/tags": { id: string };
			"/[id]/tasks": { id: string }
		};
		Pathname(): "/" | "/api/ical-proxy" | "/api/telegram/send-key" | "/badges-demo" | "/demo" | "/global" | "/navigator" | "/qr-demo" | "/qr" | "/qr/test" | "/sdgs" | `/sdgs/${string}` & {} | `/${string}` & {} | `/${string}/badges` & {} | `/${string}/calendar` & {} | `/${string}/calendar/feed.ics` & {} | `/${string}/card-generator` & {} | `/${string}/checklists` & {} | `/${string}/contracts` & {} | `/${string}/council` & {} | `/${string}/dashboard` & {} | `/${string}/db` & {} | `/${string}/dna` & {} | `/${string}/documentation` & {} | `/${string}/documentation/dashboard` & {} | `/${string}/events` & {} | `/${string}/expenses` & {} | `/${string}/federation` & {} | `/${string}/flow` & {} | `/${string}/global-holons` & {} | `/${string}/holons` & {} | `/${string}/library` & {} | `/${string}/map` & {} | `/${string}/navigator` & {} | `/${string}/offers` & {} | `/${string}/orbits` & {} | `/${string}/proposals` & {} | `/${string}/questionnaires` & {} | `/${string}/roles` & {} | `/${string}/schedule` & {} | `/${string}/settings` & {} | `/${string}/shopping` & {} | `/${string}/statistics` & {} | `/${string}/status` & {} | `/${string}/tags` & {} | `/${string}/tasks` & {};
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/assets/images/sdgs/01.jpg" | "/assets/images/sdgs/02.jpg" | "/assets/images/sdgs/03.jpg" | "/assets/images/sdgs/04.jpg" | "/assets/images/sdgs/05.jpg" | "/assets/images/sdgs/06.jpg" | "/assets/images/sdgs/07.jpg" | "/assets/images/sdgs/08.jpg" | "/assets/images/sdgs/09.jpg" | "/assets/images/sdgs/10.jpg" | "/assets/images/sdgs/11.jpg" | "/assets/images/sdgs/12.jpg" | "/assets/images/sdgs/13.jpg" | "/assets/images/sdgs/14.jpg" | "/assets/images/sdgs/15.jpg" | "/assets/images/sdgs/16.jpg" | "/assets/images/sdgs/17.jpg" | "/background.png" | "/favicon.png" | "/favicon.svg" | "/images/1.jpg" | "/images/2.png" | "/images/ts.svg" | "/robots.txt" | string & {};
	}
}