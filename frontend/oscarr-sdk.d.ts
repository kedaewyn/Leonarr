/** Ambient types for the `@oscarr/sdk` module, provided at runtime by Oscarr's
 *  `/_plugin-runtime/oscarr.js` importmap shim (see packages/frontend/public/_plugin-runtime).
 *  Plugins don't bundle this module — esbuild marks it external, and the browser's importmap
 *  resolves it to the host's own SDK instance, so plugin calls share the host's auth cookies
 *  and CSRF header. */
declare module '@oscarr/sdk' {
  /** GET an Oscarr API path and parse the JSON response. Throws on non-2xx. */
  export function api<T = unknown>(path: string, options?: RequestInit): Promise<T>;
  /** POST a JSON body. */
  export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** PUT a JSON body. */
  export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** DELETE. */
  export function apiDelete<T = unknown>(path: string): Promise<T>;
}
