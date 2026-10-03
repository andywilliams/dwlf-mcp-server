import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DWLFClient } from '../client.js';
export declare const MA_TYPES: string[];
type MaPoint = {
    date: string;
    value: number;
};
export declare function withLatestMovingAverages(data: unknown): {
    latest: Record<string, MaPoint>;
    missing: string[];
};
export declare function registerIndicatorTools(server: McpServer, client: DWLFClient): void;
export {};
//# sourceMappingURL=indicators.d.ts.map