/** Local mirror of the Oscarr PluginContext v1.1 surface.
 *
 *  We vendor the type shapes instead of importing `@oscarr/shared` so the plugin repo
 *  stays standalone (no monorepo link required). The types must track
 *  `Oscarr/packages/shared/src/pluginContext.ts` — breaking changes upstream will show up
 *  here on next sync. That's intentional: a silent drift would be worse than a typecheck
 *  failure pointing us at this file.
 *
 *  Scope: only the subset Leonarr actually consumes. Other plugins may vendor a wider
 *  surface — that's fine, we're deliberately narrow.
 */

import type { FastifyInstance, FastifyBaseLogger } from 'fastify';

// ─── Shapes mirrored from @oscarr/shared/pluginContext.ts ─────────────

export interface PluginMedia {
  id: number;
  tmdbId: number;
  tvdbId: number | null;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  status: string;
}

export interface PluginMediaRequest {
  id: number;
  userId: number;
  mediaType: 'movie' | 'tv';
  seasons: number[] | null;
  status: string;
  createdAt: string;
  media: PluginMedia;
}

export type PluginMediaBatchKey = `${'movie' | 'tv'}:${number}`;

export interface PluginMediaBatchStatus {
  status: string;
  userRequestStatus: string | null;
  userHasActiveRequest: boolean;
}

export interface PluginTmdbSearchPage {
  page: number;
  results: PluginTmdbMedia[];
  total_pages: number;
  total_results: number;
}

/** Loose shape — TMDB multi-search mixes movie/tv/person rows with heterogeneous fields. */
export interface PluginTmdbMedia {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  [key: string]: unknown;
}

export interface PluginTmdbMovie {
  id: number;
  title: string;
  overview?: string;
  poster_path: string | null;
  release_date?: string;
  [key: string]: unknown;
}

export interface PluginTmdbTv {
  id: number;
  name: string;
  overview?: string;
  poster_path: string | null;
  first_air_date?: string;
  [key: string]: unknown;
}

export interface PluginUserNotificationCreatedV1 {
  v: 1;
  userId: number;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PluginMediaAvailableV1 {
  v: 1;
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  requesterUserIds: number[];
}

// ─── ArrClient subset Leonarr uses ────────────────────────────────────

export interface ArrQueueItem {
  sizeleft?: number;
  size?: number;
  status?: string;
  movie?: { tmdbId?: number };
  series?: { tvdbId?: number };
}

export interface ArrClient {
  getQueue(): Promise<ArrQueueItem[] | null | undefined>;
  [key: string]: unknown;
}

// ─── User shape returned by ctx.getUser / findUserByProvider ──────────

export interface OscarrUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  avatar: string | null;
}

export interface OscarrUserProvider {
  provider: string;
  providerId: string | null;
  providerUsername: string | null;
  providerEmail: string | null;
}

// ─── Leonarr's view of ctx — only the methods we call ─────────────────

/** Result of ctx.requests.create — discriminated union for explicit handling. */
export type CreateRequestResult =
  | { ok: true; requestId: number; status: string; autoApproved: boolean; sendFailed?: boolean }
  | { ok: false; code: string; error: string };

export interface Ctx {
  log: FastifyBaseLogger;

  getUser(userId: number): Promise<OscarrUser | null>;
  findUserByProvider(provider: string, providerId: string): Promise<OscarrUser | null>;
  getUserProviders(userId: number): Promise<OscarrUserProvider[]>;

  getAppSettings(): Promise<Record<string, unknown>>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;

  getArrClients(serviceType: string): Promise<ArrClient[]>;

  tmdb: {
    search(query: string, options?: { page?: number; lang?: string }): Promise<PluginTmdbSearchPage>;
    movie(tmdbId: number, options?: { lang?: string }): Promise<PluginTmdbMovie>;
    tv(tmdbId: number, options?: { lang?: string }): Promise<PluginTmdbTv>;
  };

  requests: {
    listForUser(
      userId: number,
      options?: { limit?: number; status?: string },
    ): Promise<PluginMediaRequest[]>;
    create(input: {
      userId: number;
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      seasons?: number[];
      rootFolder?: string;
      qualityOptionId?: number;
      skipPluginGuard?: boolean;
    }): Promise<CreateRequestResult>;
  };

  events: {
    on(event: string, handler: (data: unknown) => void | Promise<void>): void;
    off(event: string, handler: (data: unknown) => void | Promise<void>): void;
    emit(event: string, data: unknown): Promise<void>;
  };

  registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }): void;
  registerPluginPermission(permission: string, description?: string): void;
}

// ─── Plugin registration shape ────────────────────────────────────────

export interface PluginRegistration {
  manifest: unknown;
  onEnable?(ctx: Ctx): Promise<void> | void;
  onDisable?(ctx: Ctx): Promise<void> | void;
  registerRoutes?(app: FastifyInstance, ctx: Ctx): Promise<void> | void;
}
