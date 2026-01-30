import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export class DWLFClient {
  private http: AxiosInstance;

  constructor() {
    const baseURL = process.env.DWLF_API_URL || 'https://api.dwlf.co.uk';
    const apiKey = process.env.DWLF_API_KEY;

    if (!apiKey) {
      console.error(
        'Warning: DWLF_API_KEY not set. Authenticated endpoints will fail.'
      );
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

  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    // Filter out undefined params
    const cleanParams: Record<string, unknown> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          cleanParams[key] = value;
        }
      }
    }

    const config: AxiosRequestConfig = {
      params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined,
    };

    const response = await this.http.get<T>(path, config);
    return response.data;
  }

  async post<T = unknown>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<T> {
    const response = await this.http.post<T>(path, data);
    return response.data;
  }
}
