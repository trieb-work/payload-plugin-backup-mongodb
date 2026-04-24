import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdminTaskEndpoint } from '../../src/endpoints/paths/admin-task'
import { makeMockPayload, makeMockRequest, readJsonBody } from './helpers'

const task = {
  id: 'task-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  kind: 'backup' as const,
  message: 'hello',
  pollSecret: 'a'.repeat(64),
  status: 'running' as const,
  updatedAt: '2024-01-01T00:00:01.000Z',
}

describe('GET /backup-mongodb/admin/task/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PAYLOAD_BACKUP_ALLOWED_ROLES
  })

  it('returns 404 when id is missing', async () => {
    const ep = createAdminTaskEndpoint({})
    const res = await ep.handler(
      makeMockRequest(makeMockPayload(), {
        method: 'get',
        routeParams: {},
        user: { id: 'admin' },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when task does not exist', async () => {
    const ep = createAdminTaskEndpoint({})
    const payload = makeMockPayload({
      findByID: vi.fn(async () => {
        throw new Error('not found')
      }),
    })
    const res = await ep.handler(
      makeMockRequest(payload, {
        method: 'get',
        routeParams: { id: 'missing' },
        user: { id: 'admin' },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('accepts the pollSecret via query param even for anonymous callers', async () => {
    const ep = createAdminTaskEndpoint({})
    const payload = makeMockPayload({
      findByID: vi.fn(async () => task),
    })
    const res = await ep.handler(
      makeMockRequest(payload, {
        method: 'get',
        routeParams: { id: 'task-1' },
        searchParams: { pollSecret: task.pollSecret },
        url: `http://localhost/api/backup-mongodb/admin/task/task-1?pollSecret=${task.pollSecret}`,
        user: null,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await readJsonBody(res)) as Record<string, unknown>
    expect(body.id).toBe('task-1')
    expect(body).not.toHaveProperty('pollSecret')
  })

  it('accepts the pollSecret via Authorization: Bearer', async () => {
    const ep = createAdminTaskEndpoint({})
    const payload = makeMockPayload({
      findByID: vi.fn(async () => task),
    })
    const res = await ep.handler(
      makeMockRequest(payload, {
        headers: { authorization: `Bearer ${task.pollSecret}` },
        method: 'get',
        routeParams: { id: 'task-1' },
        user: null,
      }),
    )
    expect(res.status).toBe(200)
  })

  it('falls back to admin auth when pollSecret is missing / wrong', async () => {
    const ep = createAdminTaskEndpoint({})
    const payload = makeMockPayload({
      findByID: vi.fn(async () => task),
    })
    const res = await ep.handler(
      makeMockRequest(payload, {
        method: 'get',
        routeParams: { id: 'task-1' },
        user: { id: 'admin' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('returns 401 when pollSecret is wrong AND caller is not an admin', async () => {
    const ep = createAdminTaskEndpoint({})
    const payload = makeMockPayload({
      findByID: vi.fn(async () => task),
    })
    const res = await ep.handler(
      makeMockRequest(payload, {
        method: 'get',
        routeParams: { id: 'task-1' },
        searchParams: { pollSecret: 'b'.repeat(64) },
        url: `http://localhost/api/backup-mongodb/admin/task/task-1?pollSecret=${'b'.repeat(64)}`,
        user: null,
      }),
    )
    expect(res.status).toBe(401)
  })
})
