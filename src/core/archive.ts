import { Readable } from 'node:stream'
import zlib from 'node:zlib'
import tar from 'tar-stream'

export function createTarGzip(files: { content: Buffer; name: string }[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pack = tar.pack()
    const gzip = zlib.createGzip()
    const chunks: Buffer[] = []

    files.forEach(({ name, content }) => {
      pack.entry({ name }, content)
    })

    pack.finalize()

    const compressedStream = pack.pipe(gzip)

    compressedStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    compressedStream.on('end', () => resolve(Buffer.concat(chunks)))
    compressedStream.on('error', reject)
  })
}

export function resolveTarGzip(fileBuffer: Buffer): Promise<{ content: Buffer; name: string }[]> {
  return new Promise<{ content: Buffer; name: string }[]>((resolve, reject) => {
    const gunzip = zlib.createGunzip()
    const extract = tar.extract()

    const files: { content: Buffer; name: string }[] = []

    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => {
        files.push({
          name: header.name,
          content: Buffer.concat(chunks),
        })
        next()
      })
      stream.resume()
    })
    extract.on('finish', () => {
      resolve(files)
    })
    extract.on('error', reject)

    const stream = Readable.from(fileBuffer)
    stream.pipe(gunzip).pipe(extract)
  })
}
