import type { Payload } from 'payload'

type MongoosePayloadDb = {
  connection?: { db?: MongoDb }
}

export type MongoDb = {
  collection: (name: string) => {
    bulkWrite: (operations: unknown[]) => Promise<{ modifiedCount: number; upsertedCount: number }>
    countDocuments: (query?: object) => Promise<number>
    deleteMany: (query: object) => Promise<unknown>
    find: (query: object) => { toArray: () => Promise<unknown[]> }
    indexes: () => Promise<{ key: Record<string, unknown>; unique?: boolean }[]>
  }
  listCollections: () => { toArray: () => Promise<{ name: string }[]> }
}

export function getDb(payload: Payload): MongoDb {
  if (payload.db.name !== 'mongoose') {
    throw new Error('Backup failed: Not a mongoose database adapter')
  }
  const db = (payload.db as MongoosePayloadDb).connection?.db
  if (!db) {
    throw new Error('Backup failed: Database not initialized')
  }
  return db
}
