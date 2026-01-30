import axios from 'axios';
export class DWLFClient {
    http;
    constructor() {
        const baseURL = process.env.DWLF_API_URL || 'https://api.dwlf.co.uk';
        const apiKey = process.env.DWLF_API_KEY;
        if (!apiKey) {
            console.error('Warning: DWLF_API_KEY not set. Authenticated endpoints will fail.');
        }
        this.http = axios.create({
            baseURL: `${baseURL}/v2`,
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `ApiKey ${apiKey}` } : {}),
            },
            timeout: 30000,
        });
    }
    async get(path, params) {
        // Filter out undefined params
        const cleanParams = {};
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    cleanParams[key] = value;
                }
            }
        }
        const config = {
            params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined,
        };
        const response = await this.http.get(path, config);
        return response.data;
    }
    async post(path, data) {
        const response = await this.http.post(path, data);
        return response.data;
    }
}
//# sourceMappingURL=client.js.map