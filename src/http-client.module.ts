import type { DynamicModule } from '@galaxy-stack/orbit-core';
import { HttpClient, type HttpClientOptions } from './http-client';

export const HTTP_CLIENT = Symbol('HTTP_CLIENT');
export const HTTP_CLIENT_OPTIONS = Symbol('HTTP_CLIENT_OPTIONS');

export class HttpClientModule {
  static forRoot(options: HttpClientOptions = {}): DynamicModule {
    return {
      module: HttpClientModule,
      global: true,
      providers: [
        { provide: HTTP_CLIENT_OPTIONS, useValue: options },
        {
          provide: HTTP_CLIENT,
          useFactory: (opts: HttpClientOptions) => new HttpClient(opts),
          inject: [HTTP_CLIENT_OPTIONS],
        },
        { provide: HttpClient, useExisting: HTTP_CLIENT },
      ],
      exports: [HTTP_CLIENT, HttpClient, HTTP_CLIENT_OPTIONS],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<HttpClientOptions> | HttpClientOptions;
    inject?: any[];
  }): DynamicModule {
    return {
      module: HttpClientModule,
      global: true,
      providers: [
        { provide: HTTP_CLIENT_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: HTTP_CLIENT,
          useFactory: (opts: HttpClientOptions) => new HttpClient(opts),
          inject: [HTTP_CLIENT_OPTIONS],
        },
        { provide: HttpClient, useExisting: HTTP_CLIENT },
      ],
      exports: [HTTP_CLIENT, HttpClient, HTTP_CLIENT_OPTIONS],
    };
  }
}

export { HttpClient };
export type { HttpClientOptions } from './http-client';
