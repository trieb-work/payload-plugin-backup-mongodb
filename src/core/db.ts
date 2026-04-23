import type { Payload } from 'payload'

export type MongoDb = {
  listCollections: () => { toArray: () => Promise<{ name: string }[]> }
  collection: (name: string) => {
    find: (query: object) => { toArray: () => Promise<any[]> }
    countDocuments: (query?: object) => Promise<number>
    deleteMany: (query: object) => Promise<any>
    bulkWrite: (operations: any[]) => Promise<any>
    indexes: () => Promise<{ unique?: boolean; key: Record<string, unknown> }[]>
  }
}

export async function getDb(payload: Payload): Promise<MongoDb> {
  if (payload.db.name !== 'mongoose') {
    throw new Error('Backup failed: Not a mongoose database adapter')
  }
  const db = (payload.db as any).connection?.db as MongoDb | undefined
  if (!db) {
    throw new Error('Backup failed: Database not initialized')
  }
  return db
}
