export interface HttpRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse<T = any> {
  ok: boolean;
  status: number;
  headers: Headers;
  data: T;
  raw: Response;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: Response,
    public readonly data?: any
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type RequestInterceptor = (url: string, init: RequestInit) => { url: string; init: RequestInit } | Promise<{ url: string; init: RequestInit }>;
export type ResponseInterceptor = (response: HttpResponse) => HttpResponse | Promise<HttpResponse>;

export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  requestInterceptors?: RequestInterceptor[];
  responseInterceptors?: ResponseInterceptor[];
  /** Thrown HttpError on non-2xx. Default: true */
  throwOnError?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeoutMs: number;
  private retries: number;
  private retryDelayMs: number;
  private requestInterceptors: RequestInterceptor[];
  private responseInterceptors: ResponseInterceptor[];
  private throwOnError: boolean;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retries = options.retries ?? 0;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.requestInterceptors = options.requestInterceptors ?? [];
    this.responseInterceptors = options.responseInterceptors ?? [];
    this.throwOnError = options.throwOnError ?? true;
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  async get<T = any>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, options);
  }

  async post<T = any>(url: string, body?: any, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, options);
  }

  async put<T = any>(url: string, body?: any, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, body, options);
  }

  async patch<T = any>(url: string, body?: any, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', url, body, options);
  }

  async delete<T = any>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  async request<T = any>(
    method: string,
    url: string,
    body?: any,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse<T>> {
    let fullUrl = this.baseUrl + url;
    const retries = options.retries ?? this.retries;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retryDelayMs = options.retryDelayMs ?? this.retryDelayMs;

    let init: RequestInit = {
      method,
      headers: {
        ...this.defaultHeaders,
        ...(options.headers ?? {}),
      },
      signal: options.signal,
    };
    if (body !== undefined) {
      if (body instanceof FormData || body instanceof ArrayBuffer || typeof body === 'string') {
        init.body = body as any;
      } else {
        (init.headers as any)['Content-Type'] = (init.headers as any)['Content-Type'] ?? 'application/json';
        init.body = JSON.stringify(body);
      }
    }

    // query params
    if (options.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
    }

    // request interceptors
    for (const interceptor of this.requestInterceptors) {
      const result = await interceptor(fullUrl, init);
      fullUrl = result.url;
      init = result.init;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = options.signal
        ? undefined
        : setTimeout(() => controller.abort(), timeoutMs);
      const signal = options.signal ?? controller.signal;

      try {
        const response = await fetch(fullUrl, { ...init, signal });
        let data: any = undefined;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        let httpResponse: HttpResponse<T> = {
          ok: response.ok,
          status: response.status,
          headers: response.headers,
          data,
          raw: response,
        };

        for (const interceptor of this.responseInterceptors) {
          httpResponse = await interceptor(httpResponse);
        }

        if (!response.ok && this.throwOnError) {
          throw new HttpError(
            `Request failed with status ${response.status}`,
            response.status,
            response,
            data
          );
        }
        return httpResponse;
      } catch (error) {
        lastError = error;
        // do not retry on 4xx (except 429) or abort-by-caller
        const status = (error as any)?.status;
        const retriable =
          !(error instanceof HttpError) ||
          status === 429 ||
          (status >= 500 && status < 600);
        if (attempt < retries && retriable) {
          await sleep(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw error;
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    }
    throw lastError;
  }
}
