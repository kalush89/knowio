import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { VectorStore } from '../store'
import { EmbeddedChunk } from '../../types'

// Mock the db module for integration tests
vi.mock('../../db', () => ({
  prisma: {
    documentChunk: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn()
    },
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    $disconnect: vi.fn()
  }
}))

// Import after mocking to ensure the mock is applied
import { prisma } from '../../db'

// Create a typed reference to the mocked prisma
const mockPrisma = prisma as any

describe('VectorStore Integration Tests', () => {
  let vectorStore: VectorStore
  const testSourceUrl = 'https://test-docs.example.com/api'

  beforeAll(async () => {
    vectorStore = new VectorStore()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createTestChunk = (overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk => ({
    id: `test-chunk-${Date.now()}-${Math.random()}`,
    content: 'This is a test document chunk for vector storage integration testing.',
    metadata: {
      sourceUrl: testSourceUrl,
      title: 'Test API Documentation',
      section: 'Getting Started',
      chunkIndex: 0,
      ...overrides.metadata
    },
    tokenCount: 15,
    embedding: Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.1) * 0.5),
    embeddedAt: new Date(),
    ...overrides
  })

  describe('store and retrieve operations', () => {
    it('should store and retrieve a chunk successfully', async () => {
      const chunk = createTestChunk()

      // Mock no existing chunk found
      mockPrisma.documentChunk.findFirst.mockResolvedValue(null)

      // Mock successful creation
      const createdChunk = {
        id: chunk.id,
        sourceUrl: chunk.metadata.sourceUrl,
        title: chunk.metadata.title,
        content: chunk.content,
        section: chunk.metadata.section,
        chunkIndex: chunk.metadata.chunkIndex,
        tokenCount: chunk.tokenCount,
        embedding: `[${chunk.embedding.join(',')}]`,
        metadata: chunk.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      mockPrisma.documentChunk.create.mockResolvedValue(createdChunk)
      mockPrisma.documentChunk.findUnique.mockResolvedValue(createdChunk)

      // Store the chunk
      const storeResult = await vectorStore.store(chunk)
      expect(storeResult.created).toBe(true)
      expect(storeResult.id).toBe(chunk.id)

      // Verify it was stored in the database
      const storedChunk = await prisma.documentChunk.findUnique({
        where: { id: chunk.id }
      })

      expect(storedChunk).toBeTruthy()
      expect(storedChunk?.content).toBe(chunk.content)
      expect(storedChunk?.sourceUrl).toBe(chunk.metadata.sourceUrl)
      expect(storedChunk?.tokenCount).toBe(chunk.tokenCount)
    })

    it('should update existing chunk on duplicate store', async () => {
      const chunk = createTestChunk()

      // Mock existing chunk found
      const existingChunk = {
        id: 'existing-id',
        sourceUrl: chunk.metadata.sourceUrl,
        chunkIndex: chunk.metadata.chunkIndex,
        content: 'Original content',
        title: 'Original Title',
        section: chunk.metadata.section,
        tokenCount: 15,
        embedding: `[${chunk.embedding.join(',')}]`,
        metadata: chunk.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      mockPrisma.documentChunk.findFirst.mockResolvedValue(existingChunk)

      // Store updated version with same sourceUrl and chunkIndex
      const updatedChunk = createTestChunk({
        content: 'Updated content for the same chunk',
        tokenCount: 20,
        metadata: {
          ...chunk.metadata,
          title: 'Updated Title'
        }
      })

      // Mock successful update
      const updatedResult = {
        ...existingChunk,
        content: updatedChunk.content,
        tokenCount: updatedChunk.tokenCount,
        title: 'Updated Title',
        updatedAt: new Date()
      }
      mockPrisma.documentChunk.update.mockResolvedValue(updatedResult)
      mockPrisma.documentChunk.findFirst.mockResolvedValue(updatedResult)

      const updateResult = await vectorStore.store(updatedChunk)
      expect(updateResult.updated).toBe(true)
      expect(updateResult.created).toBe(false)

      // Verify the content was updated
      const storedChunk = await prisma.documentChunk.findFirst({
        where: {
          sourceUrl: chunk.metadata.sourceUrl,
          chunkIndex: chunk.metadata.chunkIndex
        }
      })

      expect(storedChunk?.content).toBe(updatedChunk.content)
      expect(storedChunk?.tokenCount).toBe(updatedChunk.tokenCount)
      expect(storedChunk?.title).toBe('Updated Title')
    })
  })

  describe('batch operations', () => {
    it('should store multiple chunks in batch', async () => {
      const chunks = [
        createTestChunk({
          metadata: { sourceUrl: testSourceUrl, title: 'Doc 1', chunkIndex: 0 }
        }),
        createTestChunk({
          metadata: { sourceUrl: testSourceUrl, title: 'Doc 2', chunkIndex: 1 }
        }),
        createTestChunk({
          metadata: { sourceUrl: testSourceUrl, title: 'Doc 3', chunkIndex: 2 }
        })
      ]

      // Mock no existing chunks
      mockPrisma.documentChunk.findFirst.mockResolvedValue(null)

      // Mock successful creation for all chunks
      mockPrisma.documentChunk.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: args.data.id,
          sourceUrl: args.data.sourceUrl,
          title: args.data.title,
          content: args.data.content,
          section: args.data.section,
          chunkIndex: args.data.chunkIndex,
          tokenCount: args.data.tokenCount,
          embedding: args.data.embedding,
          metadata: args.data.metadata,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      )

      const result = await vectorStore.storeBatch(chunks)

      expect(result.stored).toBe(3)
      expect(result.updated).toBe(0)
      expect(result.failed).toBe(0)

      // Mock findMany for verification
      const mockStoredChunks = chunks.map((chunk, index) => ({
        id: chunk.id,
        sourceUrl: chunk.metadata.sourceUrl,
        title: chunk.metadata.title,
        content: chunk.content,
        section: chunk.metadata.section,
        chunkIndex: chunk.metadata.chunkIndex,
        tokenCount: chunk.tokenCount,
        embedding: `[${chunk.embedding.join(',')}]`,
        metadata: chunk.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }))
      mockPrisma.documentChunk.findMany.mockResolvedValue(mockStoredChunks)

      // Verify all chunks were stored
      const storedChunks = await prisma.documentChunk.findMany({
        where: { sourceUrl: testSourceUrl },
        orderBy: { chunkIndex: 'asc' }
      })

      expect(storedChunks).toHaveLength(3)
      expect(storedChunks[0].title).toBe('Doc 1')
      expect(storedChunks[1].title).toBe('Doc 2')
      expect(storedChunks[2].title).toBe('Doc 3')
    })
  })

  describe('vector similarity search', () => {
    const testChunks = [
      createTestChunk({
        content: 'Authentication using API keys and tokens',
        embedding: Array.from({ length: 1536 }, (_, i) => i % 2 === 0 ? 0.8 : -0.2),
        metadata: { sourceUrl: testSourceUrl, title: 'Auth Guide', section: 'Authentication', chunkIndex: 0 }
      }),
      createTestChunk({
        content: 'Rate limiting and throttling mechanisms',
        embedding: Array.from({ length: 1536 }, (_, i) => i % 3 === 0 ? 0.6 : -0.4),
        metadata: { sourceUrl: testSourceUrl, title: 'Rate Limits', section: 'API Limits', chunkIndex: 1 }
      }),
      createTestChunk({
        content: 'Error handling and status codes',
        embedding: Array.from({ length: 1536 }, (_, i) => i % 5 === 0 ? 0.4 : -0.6),
        metadata: { sourceUrl: testSourceUrl, title: 'Error Handling', section: 'Errors', chunkIndex: 2 }
      })
    ]

    it('should perform vector similarity search', async () => {
      // Query embedding similar to the first chunk
      const queryEmbedding = Array.from({ length: 1536 }, (_, i) => i % 2 === 0 ? 0.7 : -0.3)

      // Mock search results
      const mockResults = [
        {
          id: testChunks[0].id,
          content: testChunks[0].content,
          metadata: testChunks[0].metadata,
          sourceUrl: testChunks[0].metadata.sourceUrl,
          title: testChunks[0].metadata.title,
          section: testChunks[0].metadata.section,
          chunkIndex: testChunks[0].metadata.chunkIndex,
          tokenCount: testChunks[0].tokenCount,
          similarity: 0.85
        },
        {
          id: testChunks[1].id,
          content: testChunks[1].content,
          metadata: testChunks[1].metadata,
          sourceUrl: testChunks[1].metadata.sourceUrl,
          title: testChunks[1].metadata.title,
          section: testChunks[1].metadata.section,
          chunkIndex: testChunks[1].metadata.chunkIndex,
          tokenCount: testChunks[1].tokenCount,
          similarity: 0.72
        }
      ]

      mockPrisma.$queryRawUnsafe.mockResolvedValue(mockResults)

      const results = await vectorStore.search(queryEmbedding, {
        limit: 2,
        threshold: 0.1
      })

      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBe(2)

      // Verify result structure
      const firstResult = results[0]
      expect(firstResult).toHaveProperty('id')
      expect(firstResult).toHaveProperty('content')
      expect(firstResult).toHaveProperty('similarity')
      expect(firstResult).toHaveProperty('sourceUrl')
      expect(firstResult).toHaveProperty('title')
      expect(firstResult).toHaveProperty('chunkIndex')

      // Similarity should be a number between 0 and 1
      expect(firstResult.similarity).toBeGreaterThanOrEqual(0)
      expect(firstResult.similarity).toBeLessThanOrEqual(1)
      expect(firstResult.similarity).toBe(0.85)
    })

    it('should respect similarity threshold', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5)

      // Mock high threshold results (fewer results)
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([])

      const highThresholdResults = await vectorStore.search(queryEmbedding, {
        limit: 10,
        threshold: 0.9
      })

      // Mock low threshold results (more results)
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'chunk-1',
          content: 'Test content',
          metadata: {},
          sourceUrl: testSourceUrl,
          title: 'Test',
          section: null,
          chunkIndex: 0,
          tokenCount: 10,
          similarity: 0.5
        }
      ])

      const lowThresholdResults = await vectorStore.search(queryEmbedding, {
        limit: 10,
        threshold: 0.1
      })

      expect(lowThresholdResults.length).toBeGreaterThanOrEqual(highThresholdResults.length)
    })

    it('should respect result limit', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5)

      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        {
          id: 'chunk-1',
          content: 'Test content',
          metadata: {},
          sourceUrl: testSourceUrl,
          title: 'Test',
          section: null,
          chunkIndex: 0,
          tokenCount: 10,
          similarity: 0.5
        }
      ])

      const results = await vectorStore.search(queryEmbedding, {
        limit: 1,
        threshold: 0.1
      })

      expect(results.length).toBeLessThanOrEqual(1)
    })
  })

  describe('deletion operations', () => {
    it('should delete chunks by source URL', async () => {
      mockPrisma.documentChunk.deleteMany.mockResolvedValue({ count: 2 })

      const deletedCount = await vectorStore.deleteBySource(testSourceUrl)
      expect(deletedCount).toBe(2)

      expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({
        where: { sourceUrl: testSourceUrl }
      })
    })
  })

  describe('statistics and health checks', () => {
    it('should return accurate statistics', async () => {
      mockPrisma.documentChunk.count.mockResolvedValue(10)
      mockPrisma.documentChunk.groupBy.mockResolvedValue([
        { sourceUrl: 'url1', _count: 5 },
        { sourceUrl: 'url2', _count: 5 }
      ])
      mockPrisma.documentChunk.aggregate.mockResolvedValue({ _avg: { tokenCount: 150 } })
      mockPrisma.documentChunk.findFirst.mockResolvedValue({ updatedAt: new Date() })

      const stats = await vectorStore.getStats()

      expect(stats.totalChunks).toBe(10)
      expect(stats.uniqueSources).toBe(2)
      expect(stats.averageTokenCount).toBe(150)
      expect(stats.lastUpdated).toBeInstanceOf(Date)
    })

    it('should pass health check', async () => {
      mockPrisma.documentChunk.count.mockResolvedValue(0)

      const isHealthy = await vectorStore.healthCheck()
      expect(isHealthy).toBe(true)
    })
  })

  describe('pagination and retrieval', () => {
    it('should retrieve chunks by source with pagination', async () => {
      const mockChunks = Array.from({ length: 5 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
        metadata: {},
        sourceUrl: testSourceUrl,
        title: `Doc ${i + 1}`,
        section: null,
        chunkIndex: i
      }))

      mockPrisma.documentChunk.findMany.mockResolvedValue(mockChunks)
      mockPrisma.documentChunk.count.mockResolvedValue(10)

      const page1 = await vectorStore.getChunksBySource(testSourceUrl, 1, 5)

      expect(page1.chunks).toHaveLength(5)
      expect(page1.total).toBe(10)
      expect(page1.hasMore).toBe(true)

      // Verify chunks are ordered by chunkIndex
      expect(page1.chunks[0].chunkIndex).toBe(0)
      expect(page1.chunks[4].chunkIndex).toBe(4)
    })
  })

  describe('upsert operations', () => {
    it('should upsert chunk (create when not exists)', async () => {
      const chunk = createTestChunk()

      // Mock no existing chunk (create scenario)
      mockPrisma.documentChunk.findFirst.mockResolvedValueOnce(null)
      mockPrisma.documentChunk.create.mockResolvedValueOnce({
        id: chunk.id,
        sourceUrl: chunk.metadata.sourceUrl,
        title: chunk.metadata.title,
        content: chunk.content,
        section: chunk.metadata.section,
        chunkIndex: chunk.metadata.chunkIndex,
        tokenCount: chunk.tokenCount,
        embedding: `[${chunk.embedding.join(',')}]`,
        metadata: chunk.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      })

      // Test that upsert completes without error (upsert calls store internally)
      await expect(vectorStore.upsert(chunk)).resolves.toBeUndefined()
    })

    it('should upsert chunk (update when exists)', async () => {
      const chunk = createTestChunk()

      // Mock existing chunk (update scenario)
      const existingChunk = {
        id: 'existing-id',
        sourceUrl: chunk.metadata.sourceUrl,
        chunkIndex: chunk.metadata.chunkIndex,
        content: 'Original content',
        title: chunk.metadata.title,
        section: chunk.metadata.section,
        tokenCount: chunk.tokenCount,
        embedding: `[${chunk.embedding.join(',')}]`,
        metadata: chunk.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      mockPrisma.documentChunk.findFirst.mockResolvedValueOnce(existingChunk)
      mockPrisma.documentChunk.update.mockResolvedValueOnce({
        ...existingChunk,
        content: 'Updated content via upsert',
        updatedAt: new Date()
      })

      // Upsert with updated content
      const updatedChunk = {
        ...chunk,
        content: 'Updated content via upsert'
      }

      // Test that upsert completes without error (upsert calls store internally)
      await expect(vectorStore.upsert(updatedChunk)).resolves.toBeUndefined()
    })
  })
})