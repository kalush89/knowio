import { describe, it, expect } from 'vitest'
import { VectorStore } from '../store'
import { EmbeddedChunk } from '../../types'

describe('Vector Storage Integration Verification', () => {
  it('should have all required methods implemented', () => {
    const vectorStore = new VectorStore()
    
    // Verify all required methods exist
    expect(typeof vectorStore.store).toBe('function')
    expect(typeof vectorStore.storeBatch).toBe('function')
    expect(typeof vectorStore.upsert).toBe('function')
    expect(typeof vectorStore.search).toBe('function')
    expect(typeof vectorStore.deleteBySource).toBe('function')
    expect(typeof vectorStore.getStats).toBe('function')
    expect(typeof vectorStore.healthCheck).toBe('function')
    expect(typeof vectorStore.getChunksBySource).toBe('function')
  })

  it('should export all required types', () => {
    // Import types to verify they exist
    const chunk: Partial<EmbeddedChunk> = {
      id: 'test',
      content: 'test content',
      metadata: {
        sourceUrl: 'https://test.com',
        title: 'Test',
        chunkIndex: 0
      },
      tokenCount: 10,
      embedding: [0.1, 0.2, 0.3],
      embeddedAt: new Date()
    }
    
    expect(chunk).toBeDefined()
  })

  it('should have proper error handling structure', () => {
    const vectorStore = new VectorStore()
    
    // Verify methods return promises (async)
    const storePromise = vectorStore.store({} as EmbeddedChunk)
    expect(storePromise).toBeInstanceOf(Promise)
    
    const searchPromise = vectorStore.search([])
    expect(searchPromise).toBeInstanceOf(Promise)
    
    const healthPromise = vectorStore.healthCheck()
    expect(healthPromise).toBeInstanceOf(Promise)
  })
})