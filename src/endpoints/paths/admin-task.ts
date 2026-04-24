import type { Endpoint } from 'payload'

import type { BackupPluginOptions } from '../../types'

import { getBackupTask, pollSecretsMatch, stripPollSecretForClient } from '../../core/taskProgress'
import { getAuthorizedBackupAdmin, jsonError } from '../shared'

export function createAdminTaskEndpoint(options: BackupPluginOptions): Endpoint {
  return {
    handler: async (req) => {
      const { payload } = req
      const id = req.routeParams?.id
      if (typeof id !== 'string' || !id) {
        return jsonError('Not found', 404)
      }

      const task = await getBackupTask(payload, id)

      if (!task) {
        return jsonError('Not found', 404)
      }

      const url = new URL((req as unknown as Request).url)
      const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1]
      const querySecret = url.searchParams.get('pollSecret')
      const provided = bearer ?? querySecret ?? ''

      const storedSecret = typeof task.pollSecret === 'string' ? task.pollSecret : null
      const pollOk = storedSecret && provided.length > 0 && pollSecretsMatch(provided, storedSecret)

      if (!pollOk) {
        const user = await getAuthorizedBackupAdmin(req, options)
        if (!user) {
          return jsonError('Unauthorized', 401)
        }
      }

      return Response.json(stripPollSecretForClient(task))
    },
    method: 'get',
    path: '/backup-mongodb/admin/task/:id',
  }
}
