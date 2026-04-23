import { describe, it, expect } from 'vitest'
import { createTarGzip, resolveTarGzip } from '../src/core/archive.js'

describe('createTarGzip', () => {
  it('creates a non-empty buffer', async () => {
    const files = [{ name: 'test.txt', content: Buffer.from('hello world') }]
    const result = await createTarGzip(files)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('creates a gzip archive (starts with gzip magic bytes)', async () => {
    const files = [{ name: 'test.txt', content: Buffer.from('hello') }]
    const result = await createTarGzip(files)
    // gzip magic bytes: 0x1f 0x8b
    expect(result[0]).toBe(0x1f)
    expect(result[1]).toBe(0x8b)
  })

  it('handles multiple files', async () => {
    const files = [
      { name: 'file1.txt', content: Buffer.from('content 1') },
      { name: 'file2.txt', content: Buffer.from('content 2') },
    ]
    const result = await createTarGzip(files)
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles empty files array', async () => {
    const result = await createTarGzip([])
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('resolveTarGzip', () => {
  it('extracts files from a tar.gz archive', async () => {
    const original = [
      { name: 'hello.txt', content: Buffer.from('hello world') },
      { name: 'data.json', content: Buffer.from(JSON.stringify({ key: 'value' })) },
    ]
    const archive = await createTarGzip(original)
    const extracted = await resolveTarGzip(archive)

    expect(extracted).toHaveLength(2)
    const helloFile = extracted.find((f) => f.name === 'hello.txt')
    const dataFile = extracted.find((f) => f.name === 'data.json')

    expect(helloFile?.content.toString()).toBe('hello world')
    expect(dataFile?.content.toString()).toBe(JSON.stringify({ key: 'value' }))
  })

  it('preserves binary content', async () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
    const archive = await createTarGzip([{ name: 'binary.bin', content: binaryContent }])
    const extracted = await resolveTarGzip(archive)

    expect(extracted[0].content).toEqual(binaryContent)
  })

  it('round-trips arbitrary JSON content', async () => {
    const data = { collections: [{ id: 1, name: 'test' }], version: '1.0' }
    const jsonContent = Buffer.from(JSON.stringify(data))
    const archive = await createTarGzip([{ name: 'collections.json', content: jsonContent }])
    const extracted = await resolveTarGzip(archive)

    const parsed = JSON.parse(extracted[0].content.toString())
    expect(parsed).toEqual(data)
  })
})
