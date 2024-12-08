declare module 'holosphere' {
    export default class HoloSphere {
        constructor(appName: string, strict?: boolean | null, openaikey?: string | null);
        
        // User Management
        createUser(username: string, password: string): Promise<object>;
        login(username: string, password: string): Promise<object>;
        logout(): Promise<void>;

        // Schema Operations
        setSchema(lens: string, schema: object): Promise<void>;
        getSchema(lens: string): Promise<object | null>;

        // Encryption Operations
        encrypt(data: any, secret: string): Promise<string>;
        decrypt(encryptedData: string, secret: string): Promise<any>;

        // Hex Data Operations
        put(holon: string, lens: string, content: object, encrypt?: boolean, secret?: string | null): Promise<void>;
        get(holon: string, lens: string, key: string): Promise<any | null>;
        delete(holon: string, lens: string, contentId: string): Promise<void>;
        getAll(holon: string, lens: string, secret?: string | null): Promise<Array<any>>;
        deleteAll(holon: string, lens: string): Promise<void>; 
     
        // Node Operations
        putNode(holon: string, lens: string, node: object): Promise<void>;
        getNode(holon: string, lens: string, key: string): Promise<any>;
        deleteNode(holon: string, lens: string, key: string): Promise<void>;

        // Global Data Operations
        putGlobal(tableName: string, data: object): Promise<void>;
        getGlobal(tableName: string, key: string): Promise<object | null>;
        deleteGlobal(tableName: string, key: string): Promise<void>;
        getAllGlobal(tableName: string): Promise<object | null>;
        deleteAllGlobal(tableName: string): Promise<void>;

        // Geospatial Operations
        getHex(lat: number, lng: number, resolution: number): Promise<string>;
        getScalespace(lat: number, lng: number): string[];
        getHexScalespace(hex: string): string[];
        compute(hex: string, lens: string, operation: string): Promise<void>;
        upcast(hex: string, lens: string, content: any): Promise<any>;

        // Subscription
        subscribe(holon: string, lens: string, callback: (data: any, key: string) => void): void;
        subscribeGlobal(tableName: string, callback: (data: any, key: string) => void): void;
    }
}