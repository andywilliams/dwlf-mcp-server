export declare function normalizeSymbol(input: string): string;
export declare class DWLFClient {
    private http;
    /** Epoch ms by which this client's caller must have answered (a host's per-call deadline), or null. */
    private readonly deadlineAt;
    /**
     * `options` overrides the environment for one client, so a multi-tenant host (the hosted MCP, DWLF-622) can build
     * one client per caller. With no options it reads DWLF_API_URL / DWLF_API_KEY, as the stdio server always has.
     * Passing `apiKey` (even as undefined) means "this caller's key": the operator's env key is never used in its
     * place. `timeoutMs` (default 30 s) keeps each request under a gateway's limit; it must be a finite positive
     * number, because axios reads 0 as "no timeout". `signal` aborts every request this client makes (a host's
     * deadline), and `deadlineAt` (epoch ms) lets a multi-page tool stop paging in time (`remainingMs`). `quiet`
     * drops the missing-key warning, for a host that builds keyless clients on purpose. `onErrorStatus` is told the
     * status of every failed response (a host drops a managed key the API has revoked).
     */
    constructor(options?: {
        apiKey?: string;
        baseURL?: string;
        timeoutMs?: number;
        signal?: AbortSignal;
        deadlineAt?: number;
        quiet?: boolean;
        onErrorStatus?: (status: number) => void;
    });
    /**
     * Build an Axios request config that strips `undefined` values from query
     * params. Returns `{}` when there are no params so axios doesn't append
     * `?` to the URL. Shared by `get` and `delete` — keep them consistent.
     */
    private buildParamsConfig;
    /** Milliseconds left before the host's deadline (Infinity with none). A paging tool stops when this runs low. */
    remainingMs(now?: number): number;
    get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
    post<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    put<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    delete<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
    deleteWithBody<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    patch<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map