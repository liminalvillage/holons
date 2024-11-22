declare module 'holosphere' {
    export default class HoloSphere {
        constructor(appName: string, openaikey?: string | null);

        // User Management
        createUser(username: string, password: string): Promise<object>;
        login(username: string, password: string): Promise<object>;
        logout(): Promise<void>;

        // Schema Operations
        setLensSchema(lens: string, schema: object): Promise<void>;
        getLensSchema(lens: string): Promise<object | null>;

        // Encryption Operations
        encrypt(data: any, secret: string): Promise<string>;
        decrypt(encryptedData: string, secret: string): Promise<any>;

        // Global Data Operations
        putGlobalData(tableName: string, data: object): Promise<void>;
        getGlobalData(tableName: string): Promise<object | null>;
        getGlobalDataKey(tableName: string, key: string): Promise<object | null>;
        deleteGlobalData(tableName: string): Promise<void>;

        // Hex Data Operations
        putHexData(hexId: string, lens: string, content: object, encrypt?: boolean, secret?: string | null): Promise<void>;
        getHexData(hexId: string, lens: string, secret?: string | null): Promise<Array<any>>;
        getHexKey(hexId: string, lens: string, key: string): Promise<any | null>;
        getHexNode(hexId: string, lens: string, key: string): Promise<any>;
        deleteHexData(hexId: string, lens: string, contentId: string): Promise<void>;
        deleteNode(nodeId: string, tag: string): Promise<void>;
        clearlens(hex: string, lens: string): Promise<void>;

        // Geospatial Operations
        getHex(lat: number, lng: number, resolution: number): Promise<string>;
        getScalespace(lat: number, lng: number): string[];
        getHexScalespace(hex: string): string[];
        compute(hex: string, lens: string, operation: string): Promise<void>;
        upcast(hex: string, lens: string, content: any): Promise<any>;

        // Subscription
        subscribe(hex: string, lens: string, callback: (data: any, key: string) => void): void;

        // Voting System
        getFinalVote(userId: string, topic: string, votes: object, visited?: Set<string>): string | null;
        aggregateVotes(hexId: string, topic: string): object;
        delegateVote(userId: string, topic: string, delegateTo: string): Promise<void>;
        vote(userId: string, hexId: string, topic: string, vote: string): Promise<void>;
    }
}