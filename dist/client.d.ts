export declare class DWLFClient {
    private http;
    constructor();
    get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T>;
    post<T = unknown>(path: string, data?: Record<string, unknown>): Promise<T>;
}
//# sourceMappingURL=client.d.ts.map