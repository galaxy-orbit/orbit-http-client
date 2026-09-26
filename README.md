<div align="center">

# @galaxy-stack/orbit-http-client

**Typed HTTP client for Orbit** — fetch wrapper with retries, timeouts, and interceptors.

[![npm version](https://img.shields.io/npm/v/@galaxy-stack/orbit-http-client.svg)](https://www.npmjs.com/package/@galaxy-stack/orbit-http-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

Part of the [Orbit framework](https://github.com/galaxy-orbit/orbit) — a NestJS-style backend framework for [Bun](https://bun.sh).

## Installation

```bash
bun add @galaxy-stack/orbit-http-client
```

## Usage

```ts
import { HttpClientModule, HttpClient, Module } from '@galaxy-stack/orbit-http-client';

@Module({
  imports: [HttpClientModule.forRoot({ baseUrl: 'https://api.example.com', retries: 2, timeoutMs: 5000 })],
})
export class AppModule {}

// anywhere with DI:
constructor(private http: HttpClient) {}

const res = await this.http.get<User[]>('/users', { query: { page: 1 } });
await this.http.post('/users', { name: 'orbit' });
```

Features: JSON serialization/parsing, query params, request/response interceptors, exponential-backoff retries (5xx + 429), timeout via AbortController, typed responses, `throwOnError` toggle.

## License

MIT
