import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EmbeddedChunk } from '../../types'

// Mock the db module at the top level
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
    $disconnect: vi.fn()
  }
}))

// Import after mocking
import { VectorStore } from '../store'
import { prisma } from '../../db'

describe('VectorStore Unit Tests', () => {
  let vectorStore: VectorStore
  const testSourceUrl = 'https://test-docs.example.com/api'
  
  beforeEach(() => {
    vectorStore = new VectorStore()
    vi.clearAllMocks()
  })

  const createTestChunk = (overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk => ({
    id: `test-chunk-${Date.now()}-${Math.random()}`,
    content: 'This is a test document chunk for vector storage testing.',
    metadata: {
      sourceUrl: testSourceUrl,
      title: 'Test API Documentation',
      section: 'Getting Started',
      chunkIndex: 0,
      ...overrides.metadata
    },
    tokenCount: 12,
    embedding: Array.from({ length: 1536 }, () => Math.random() - 0.5),
    embeddedAt: new Date(),
    ...overrides
  })

  describe('store', () => {
    it('should store a new chunk successfully', async () => {
      const chunk = createTestChunk()
      
      // Mock no existing chunk found
      vi.mocked(prisma.documentChunk.findFirst).mockResolvedValue(null)
      
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
      vi.mocked(prisma.documentChunk.create).mockResolvedValue(createdChunk)
      
      const result = await vectorStore.store(chunk)
      
      expect(result.created).toBe(true)
      expect(result.updated).toBe(false)
      expect(result.id).toBe(chunk.id)

      // Verify the correct methods were called
      expect(prisma.documentChunk.findFirst).toHaveBeenCalledWith({
        where: {
          sourceUrl: chunk.metadata.sourceUrl,
          chunkIndex: chunk.metadata.chunkIndex
        }
      })
      expect(prisma.documentChunk.create).toHaveBeenCalled()
    })

    it('should update existing chunk when storing duplicate', async () => {
      const chunk = createTestChunk()
      
      // Mock existing chunk found
      const existingChunk = {
        id: 'existing-id',
        sourceUrl: chunk.metadata.sourceUrl,
        chunkIndex: chunk.metadata.chunkIndex
      }
      vi.mocked(prisma.documentChunk.findFirst).mockResolvedValue(existingChunk)
      
      // Mock successful update
      vi.mocked(prisma.documentChunk.update).mockResolvedValue({
        ...existingChunk,
        content: chunk.content,
        updatedAt: new Date()
      })
      
      const result = await vectorStore.store(chunk)
      
      expect(result.created).toBe(false)
      expect(result.updated).toBe(true)
      expect(result.id).toBe(existingChunk.id)

      // Verify update was called
      expect(prisma.documentChunk.update).toHaveBeenCalledWith({
        where: { id: existingChunk.id },
        data: expect.objectContaining({
          content: chunk.content,
          tokenCount: chunk.tokenCount
        })
      })
    })

    it('should handle storage errors gracefully', async () => {
      const chunk = createTestChunk()
      
      // Mock database error
      vi.mocked(prisma.documentChunk.findFirst).mockRejectedValue(new Error('Database connection failed'))
      
      await expect(vectorStore.store(chunk)).rejects.toThrow('Failed to store vector chunk')
    })
  })

  describe('search', () => {
    it('should perform vector similarity search', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, (_, i) => i % 2 === 0 ? 0.4 : -0.4)
      
      // Mock search results
      const mockResults = [
        {
          id: 'chunk-1',
          content: 'Authentication using API keys',
          metadata: { sourceUrl: testSourceUrl, title: 'Auth Guide' },
          sourceUrl: testSourceUrl,
          title: 'Auth Guide',
          section: 'Getting Started',
          chunkIndex: 0,
          tokenCount: 10,
          similarity: 0.85
        }
      ]
      
      vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(mockResults)
      
      const results = await vectorStore.search(queryEmbedding, { limit: 5, threshold: 0.1 })
      
      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBe(1)
      
      // Verify result structure
      const firstResult = results[0]
      expect(firstResult).toHaveProperty('id')
      expect(firstResult).toHaveProperty('content')
      expect(firstResult).toHaveProperty('similarity')
      expect(firstResult).toHaveProperty('sourceUrl')
      expect(firstResult.similarity).toBe(0.85)
    })

    it('should handle search errors gracefully', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5)
      
      vi.mocked(prisma.$queryRawUnsafe).mockRejectedValue(new Error('Vector search failed'))
      
      await expect(vectorStore.search(queryEmbedding)).rejects.toThrow('Vector search failed')
    })
  })

  describe('deleteBySource', () => {
    it('should delete all chunks from a source URL', async () => {
      vi.mocked(prisma.documentChunk.deleteMany).mockResolvedValue({ count: 2 })
      
      const deletedCount = await vectorStore.deleteBySource(testSourceUrl)
      
      expect(deletedCount).toBe(2)
      expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({
        where: { sourceUrl: testSourceUrl }
      })
    })

    it('should handle delete errors gracefully', async () => {
      vi.mocked(prisma.documentChunk.deleteMany).mockRejectedValue(new Error('Delete failed'))
      
      await expect(vectorStore.deleteBySource(testSourceUrl)).rejects.toThrow('Failed to delete chunks by source')
    })
  })

  describe('getStats', () => {
    it('should return accurate vector store statistics', async () => {
      vi.mocked(prisma.documentChunk.count).mockResolvedValue(10)
      vi.mocked(prisma.documentChunk.groupBy).mockResolvedValue([
        { sourceUrl: 'url1', _count: 5 },
        { sourceUrl: 'url2', _count: 5 }
      ])
      vi.mocked(prisma.documentChunk.aggregate).mockResolvedValue({ _avg: { tokenCount: 150 } })
      vi.mocked(prisma.documentChunk.findFirst).mockResolvedValue({ updatedAt: new Date() })
      
      const stats = await vectorStore.getStats()
      
      expect(stats.totalChunks).toBe(10)
      expect(stats.uniqueSources).toBe(2)
      expect(stats.averageTokenCount).toBe(150)
      expect(stats.lastUpdated).toBeInstanceOf(Date)
    })
  })

  describe('healthCheck', () => {
    it('should return true when database is accessible', async () => {
      vi.mocked(prisma.documentChunk.count).mockResolvedValue(0)
      
      const isHealthy = await vectorStore.healthCheck()
      expect(isHealthy).toBe(true)
    })

    it('should return false when database is not accessible', async () => {
      vi.mocked(prisma.documentChunk.count).mockRejectedValue(new Error('Connection failed'))
      
      const isHealthy = await vectorStore.healthCheck()
      expect(isHealthy).toBe(false)
    })
  })

  describe('storeBatch', () => {
    it('should store multiple chunks successfully', async () => {
      const chunks = [
        createTestChunk({ metadata: { sourceUrl: testSourceUrl, title: 'Doc 1', chunkIndex: 0 } }),
        createTestChunk({ metadata: { sourceUrl: testSourceUrl, title: 'Doc 2', chunkIndex: 1 } })
      ]
      
      // Mock no existing chunks
      vi.mocked(prisma.documentChunk.findFirst).mockResolvedValue(null)
      
      // Mock successful creation for all chunks
      vi.mocked(prisma.documentChunk.create).mockImplementation((data) => 
        Promise.resolve({
          id: data.data.id,
          ...data.data,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      )
      
      const result = await vectorStore.storeBatch(chunks)
      
      expect(result.stored).toBe(2)
      expect(result.updated).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('upsert', () => {
    it('should call store method', async () => {
      const chunk = createTestChunk()
      
      // Mock no existing chunk
      vi.mocked(prisma.documentChunk.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.documentChunk.create).mockResolvedValue({
        id: chunk.id,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      
      await vectorStore.upsert(chunk)
      
      expect(prisma.documentChunk.findFirst).toHaveBeenCalled()
      expect(prisma.documentChunk.create).toHaveBeenCalled()
    })
  })
})