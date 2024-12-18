declare class HoloSphere {
    private appname;
    private strict;
    private validator;
    private gun;
    private openai?;
    /**
     * Initializes a new instance of the HoloSphere class.
     * @param {string} appname - The name of the application.
     * @param {boolean} strict - Whether to enforce strict schema validation.
     * @param {string|null} openaikey - The OpenAI API key.
     */
    constructor(appname: string, strict?: boolean, openaikey?: string | null);
    setSchema(lens: string, schema: object): Promise<boolean>;
    getSchema(lens: string): Promise<object | null>;
    put(holon: string, lens: string, data: object): Promise<boolean>;
    get(holon: string, lens: string, key: string): Promise<any | null>;
    getAll(holon: string, lens: string): Promise<Array<any>>;
    delete(holon: string, lens: string, key: string): Promise<void>;
    deleteAll(holon: string, lens: string): Promise<boolean>;
    putNode(holon: string, lens: string, node: object): Promise<boolean>;
    getNode(holon: string, lens: string, key: string): Promise<any | null>;
    deleteNode(holon: string, lens: string, key: string): Promise<boolean>;
    putGlobal(tableName: string, data: object): Promise<void>;
    getGlobal(tableName: string, key: string): Promise<object | null>;
    getAllGlobal(tableName: string): Promise<object | null>;
    deleteGlobal(tableName: string, key: string): Promise<void>;
    deleteAllGlobal(tableName: string): Promise<void>;
    getHolon(lat: number, lng: number, resolution: number): Promise<string>;
    getScalespace(lat: number, lng: number): string[];
    getHolonScalespace(holon: string): string[];
    compute(holon: string, lens: string, operation: string): Promise<void>;
    private parse;
    subscribe(holon: string, lens: string, callback: (data: any, key: string) => void): void;
    subscribeGlobal(tableName: string, callback: (data: any, key: string) => void): void;
    /**
     * Summarizes provided history text using OpenAI.
     * @param {string} history - The history text to summarize.
     * @returns {Promise<string>} - The summarized text.
     */
    private summarize;
}
export default HoloSphere;
