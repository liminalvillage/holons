declare module 'holosphere' {
    export default class HoloSphere {
        constructor(name: string, openaikey?: string | null);
        subscribe(hex: string, lense: string, callback: (item: any, key: string) => void): void;
        put(hex: string, lense: string, content: any): Promise<void>;
        delete(id: string, tag: string): Promise<void>;
        get(hex: string, lense: string): Promise<any[]>;
        getKey(hex: string, lense: string, key: string): Promise<any | null>;
        getNode(hex: string, lense: string, key: string): Promise<any | null>;
        compute(hex: string, lense: string, operation: string): Promise<void>;
        clearlense(hex: string, lense: string): Promise<void>;
        summarize(history: string): Promise<string>;
        upcast(hex: string, lense: string, content: any): Promise<any>;
        updateParent(id: string, report: string): Promise<any>;
        getHex(lat: number, lng: number, resolution: number): Promise<string>;
        getScalespace(lat: number, lng: number): string[];
        getHexScalespace(hex: string): string[];
        aggregateVotes(hexId: string, topic: string): object;
        delegateVote(userId: string, topic: string, delegateTo: string): Promise<void>;
        vote(userId: string, hexId: string, topic: string, vote: string): Promise<void>;
    }
}