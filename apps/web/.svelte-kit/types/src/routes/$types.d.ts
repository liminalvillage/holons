import type * as Kit from '@sveltejs/kit';

type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;
type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;
type RouteParams = {  };
type RouteId = '/';
type MaybeWithVoid<T> = {} extends T ? T | void : T;
export type RequiredKeys<T> = { [K in keyof T]-?: {} extends { [P in K]: T[K] } ? never : K; }[keyof T];
type OutputDataShape<T> = MaybeWithVoid<Omit<App.PageData, RequiredKeys<T>> & Partial<Pick<App.PageData, keyof T & keyof App.PageData>> & Record<string, any>>
type EnsureDefined<T> = T extends null | undefined ? {} : T;
type OptionalUnion<U extends Record<string, any>, A extends keyof U = U extends U ? keyof U : never> = U extends unknown ? { [P in Exclude<A, keyof U>]?: never } & U : never;
export type Snapshot<T = any> = Kit.Snapshot<T>;
type PageParentData = EnsureDefined<LayoutData>;
type LayoutRouteId = RouteId | "/" | "/[id]" | "/[id]/badges" | "/[id]/calendar" | "/[id]/card-generator" | "/[id]/checklists" | "/[id]/contracts" | "/[id]/council" | "/[id]/dashboard" | "/[id]/db" | "/[id]/dna" | "/[id]/documentation" | "/[id]/documentation/dashboard" | "/[id]/events" | "/[id]/expenses" | "/[id]/federation" | "/[id]/flow" | "/[id]/global-holons" | "/[id]/holons" | "/[id]/library" | "/[id]/map" | "/[id]/navigator" | "/[id]/offers" | "/[id]/orbits" | "/[id]/proposals" | "/[id]/questionnaires" | "/[id]/roles" | "/[id]/schedule" | "/[id]/settings" | "/[id]/shopping" | "/[id]/statistics" | "/[id]/status" | "/[id]/tags" | "/[id]/tasks" | "/badges-demo" | "/demo" | "/global" | "/navigator" | "/qr" | "/qr/test" | "/qr-demo" | "/sdgs" | "/sdgs/[sdg]" | null
type LayoutParams = RouteParams & { id?: string; sdg?: string }
type LayoutParentData = EnsureDefined<{}>;

export type PageServerData = null;
export type PageData = Expand<PageParentData>;
export type PageProps = { params: RouteParams; data: PageData }
export type LayoutServerData = null;
export type LayoutLoad<OutputData extends OutputDataShape<LayoutParentData> = OutputDataShape<LayoutParentData>> = Kit.Load<LayoutParams, LayoutServerData, LayoutParentData, OutputData, LayoutRouteId>;
export type LayoutLoadEvent = Parameters<LayoutLoad>[0];
export type LayoutData = Expand<Omit<LayoutParentData, keyof Kit.LoadProperties<Awaited<ReturnType<typeof import('./proxy+layout.js').load>>>> & OptionalUnion<EnsureDefined<Kit.LoadProperties<Awaited<ReturnType<typeof import('./proxy+layout.js').load>>>>>>;
export type LayoutProps = { params: LayoutParams; data: LayoutData; children: import("svelte").Snippet }