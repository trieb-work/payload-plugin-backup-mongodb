import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import { backupMongodbPlugin } from '@trieb.work/payload-plugin-backup-mongodb'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  // Use an in-memory MongoDB replica set whenever no external connection string is provided.
  // This keeps the dev/test experience zero-config.
  const hasExternalDb = Boolean(process.env.DATABASE_URL || process.env.MONGODB_URI)
  if (!hasExternalDb) {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
    process.env.MONGODB_URI = process.env.DATABASE_URL
  } else {
    // Keep both env names in sync so downstream code can rely on either.
    if (!process.env.DATABASE_URL && process.env.MONGODB_URI) {
      process.env.DATABASE_URL = process.env.MONGODB_URI
    }
    if (!process.env.MONGODB_URI && process.env.DATABASE_URL) {
      process.env.MONGODB_URI = process.env.DATABASE_URL
    }
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'posts',
        fields: [],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [backupMongodbPlugin({})],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
