export declare function normalizeSymbol(input: string): string;
export declare class DWLFClient {
    private http;
    /**
     * `options` overrides the environment for one client, so a multi-tenant host (the hosted-MCP spike, DWLF-622)
     * can build one client per caller. With no options it reads DWLF_API_URL / DWLF_API_KEY, as the stdio server
     * always has.
     */
    constructor(options?: {
        apiKey?: string;
        baseURL?: string;
    });
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
    deleteWithBody<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    patch<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map