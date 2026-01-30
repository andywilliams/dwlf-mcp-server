export declare function normalizeSymbol(input: string): string;
export declare class DWLFClient {
    private http;
    constructor();
    get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
    post<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    put<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
    delete<T = unknown>(path: string): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map