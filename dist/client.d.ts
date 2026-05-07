export declare function normalizeSymbol(input: string): string;
export declare class DWLFClient {
    private http;
    constructor();
    /**
     * Build an Axios request config that strips `undefined` values from query
     * params. Returns `{}` when there are no params so axios doesn't append
     * `?` to the URL. Shared by `get` and `delete` — keep them consistent.
     */
    private buildParamsConfig;
    get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
    post<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    put<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    delete<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map