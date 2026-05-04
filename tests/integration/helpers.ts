import type { PayloadRequest } from 'payload'

import { vi } from 'vitest'

type MinimalRequestInit = {
  body?: unknown
  headers?: Record<string, string>
  method?: string
  routeParams?: Record<string, string>
  searchParams?: Record<string, string>
  url?: string
  user?: null | Record<string, unknown>
}

type MinimalPayloadLike = {
  auth?: ReturnType<typeof vi.fn>
  count?: ReturnType<typeof vi.fn>
  create?: ReturnType<typeof vi.fn>
  db?: {
    connection?: { db?: unknown }
    name?: string
  }
  find?: ReturnType<typeof vi.fn>
  findByID?: ReturnType<typeof vi.fn>
  logger?: {
    debug: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
  }
  update?: ReturnType<typeof vi.fn>
}

export function makeMockLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}

export function makeMockPayload(overrides: Partial<MinimalPayloadLike> = {}): MinimalPayloadLike {
  return {
    auth: vi.fn(async () => ({ user: null })),
    count: vi.fn(async () => ({ totalDocs: 0 })),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      ...args.data,
      id: 'task-id-1',
    })),
    find: vi.fn(async () => ({ docs: [] })),
    findByID: vi.fn(async () => null),
    logger: makeMockLogger(),
    update: vi.fn(async (args: { data: Record<string, unknown>; id: string }) => ({
      ...args.data,
      id: args.id,
    })),
    ...overrides,
  }
}

/**
 * Builds a minimal object compatible with PayloadRequest so endpoint handlers
 * can be exercised in isolation. Only the fields actually read by the handlers
 * under test are populated.
 */
export function makeMockRequest(
  payload: MinimalPayloadLike,
  init: MinimalRequestInit = {},
): PayloadRequest {
  const headers = new Headers(init.headers ?? {})
  const url = init.url ?? 'http://localhost/api/backup-mongodb/admin/x'
  const searchParamsSrc = init.searchParams ?? {}
  const searchParams = new URLSearchParams(searchParamsSrc)
  const body = init.body
  return {
    headers,
    json: async () => body,
    method: init.method ?? 'post',
    payload,
    routeParams: init.routeParams ?? {},
    searchParams,
    url,
    user: init.user,
  } as unknown as PayloadRequest
}

export async function readJsonBody(res: Response): Promise<unknown> {
  return res.clone().json()
}
