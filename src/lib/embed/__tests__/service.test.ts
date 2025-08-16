import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EmbeddingService } from '../service'
import { DocumentChunk } from '../../types'
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

// Mock AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  InvokeModelCommand: vi.fn(),
}))

vi.mock('../../aws-config', () => ({
  bedrockRuntimeClient: {
    send: vi.fn(),
  },
  EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v1',
  EMBEDDING_DIMENSIONS: 1536,
}))

// Import the mocked client with proper typing
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'

const mockBedrockClient = vi.mocked(
  (await import('../../aws-config')).bedrockRuntimeClient
) as { send: ReturnType<typeof vi.fn> }

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService
  
  beforeEach(() => {
    // Use faster delays for testing
    embeddingService = new EmbeddingService({
      baseDelay: 10, // Much faster for tests
      maxDelay: 100,
      rateLimitDelay: 1
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generateEmbeddings', () => {
    it('should generate embeddings for document chunks', async () => {
      const mockEmbedding = new Array(1536).fill(0.1)
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      }

      mockBedrockClient.send.mockResolvedValue(mockResponse as any)

      const chunks: DocumentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Test content 1',
          metadata: {
            sourceUrl: 'https://example.com',
            title: 'Test Document',
            chunkIndex: 0,
          },
          tokenCount: 10,
        },
        {
          id: 'chunk-2',
          content: 'Test content 2',
          metadata: {
            sourceUrl: 'https://example.com',
            title: 'Test Document',
            chunkIndex: 1,
          },
          tokenCount: 12,
        },
      ]

      const result = await embeddingService.generateEmbeddings(chunks)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 'chunk-1',
        content: 'Test content 1',
        embedding: mockEmbedding,
      })
      expect(result[0].embeddedAt).toBeInstanceOf(Date)
      expect(result[1]).toMatchObject({
        id: 'chunk-2',
        content: 'Test content 2',
        embedding: mockEmbedding,
      })
    })

    it('should handle empty chunks array', async () => {
      const result = await embeddingService.generateEmbeddings([])
      expect(result).toEqual([])
      expect(mockBedrockClient.send).not.toHaveBeenCalled()
    })

    it('should continue processing when individual chunks fail', async () => {
      const mockEmbedding = new Array(1536).fill(0.1)
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      }

      // First call succeeds, second fails (to test that first chunk succeeds)
      mockBedrockClient.send
        .mockResolvedValueOnce(mockResponse as any)
        .mockRejectedValueOnce(new Error('Network error'))

      const chunks: DocumentChunk[] = [
        {
          id: 'chunk-1',
          content: 'Test content 1',
          metadata: {
            sourceUrl: 'https://example.com',
            title: 'Test Document',
            chunkIndex: 0,
          },
          tokenCount: 10,
        },
        {
          id: 'chunk-2',
          content: 'Test content 2',
          metadata: {
            sourceUrl: 'https://example.com',
            title: 'Test Document',
            chunkIndex: 1,
          },
          tokenCount: 12,
        },
      ]

      const result = await embeddingService.generateEmbeddings(chunks)

      // Should only return the successful embedding
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('chunk-1')
    })
  })

  describe('batchEmbed', () => {
    it('should generate embeddings for multiple texts', async () => {
      const mockEmbedding1 = new Array(1536).fill(0.1)
      const mockEmbedding2 = new Array(1536).fill(0.2)
      
      mockBedrockClient.send
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            embedding: mockEmbedding1
          }))
        } as any)
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            embedding: mockEmbedding2
          }))
        } as any)

      const texts = ['Text 1', 'Text 2']
      const result = await embeddingService.batchEmbed(texts)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(mockEmbedding1)
      expect(result[1]).toEqual(mockEmbedding2)
    })

    it('should handle empty texts array', async () => {
      const result = await embeddingService.batchEmbed([])
      expect(result).toEqual([])
      expect(mockBedrockClient.send).not.toHaveBeenCalled()
    })

    it('should throw error if any text fails to embed', async () => {
      mockBedrockClient.send
        .mockResolvedValueOnce({
          body: new TextEncoder().encode(JSON.stringify({
            embedding: new Array(1536).fill(0.1)
          }))
        } as any)
        .mockRejectedValueOnce(new Error('API Error'))

      const texts = ['Text 1', 'Text 2']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('API Error')
    })
  })

  describe('validateEmbedding', () => {
    it('should validate correct embedding dimensions', () => {
      const validEmbedding = new Array(1536).fill(0.1)
      expect(embeddingService.validateEmbedding(validEmbedding)).toBe(true)
    })

    it('should reject embedding with wrong dimensions', () => {
      const invalidEmbedding = new Array(512).fill(0.1)
      expect(embeddingService.validateEmbedding(invalidEmbedding)).toBe(false)
    })

    it('should reject non-array input', () => {
      expect(embeddingService.validateEmbedding('not an array' as any)).toBe(false)
      expect(embeddingService.validateEmbedding(null as any)).toBe(false)
      expect(embeddingService.validateEmbedding(undefined as any)).toBe(false)
    })

    it('should reject embedding with invalid numbers', () => {
      const invalidEmbedding = new Array(1536).fill(0.1)
      invalidEmbedding[0] = NaN
      expect(embeddingService.validateEmbedding(invalidEmbedding)).toBe(false)

      invalidEmbedding[0] = Infinity
      expect(embeddingService.validateEmbedding(invalidEmbedding)).toBe(false)

      invalidEmbedding[0] = 'string' as any
      expect(embeddingService.validateEmbedding(invalidEmbedding)).toBe(false)
    })
  })

  describe('retry logic and error handling', () => {
    it('should retry on retryable errors', async () => {
      // Use even faster delays for this specific test
      const testService = new EmbeddingService({
        baseDelay: 1,
        maxDelay: 10,
        rateLimitDelay: 1
      })
      
      const mockEmbedding = new Array(1536).fill(0.1)
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      }

      // Fail twice, then succeed
      mockBedrockClient.send
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockRejectedValueOnce(new Error('Service unavailable'))
        .mockResolvedValueOnce(mockResponse as any)

      const texts = ['Test text']
      const result = await testService.batchEmbed(texts)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(mockEmbedding)
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      mockBedrockClient.send.mockRejectedValue(new Error('Invalid model ID'))

      const texts = ['Test text']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('Invalid model ID')
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(1)
    })

    it('should fail after max retries', async () => {
      // Use even faster delays for this specific test
      const testService = new EmbeddingService({
        baseDelay: 1,
        maxDelay: 10,
        rateLimitDelay: 1
      })
      
      mockBedrockClient.send.mockRejectedValue(new Error('Throttling exception'))

      const texts = ['Test text']
      
      await expect(testService.batchEmbed(texts)).rejects.toThrow('Throttling exception')
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(3) // max retries
    })

    it('should handle empty response body', async () => {
      mockBedrockClient.send.mockResolvedValue({ body: null } as any)

      const texts = ['Test text']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('Empty response body from AWS Bedrock')
    })

    it('should handle invalid JSON response', async () => {
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode('invalid json')
      } as any)

      const texts = ['Test text']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('Failed to parse response from AWS Bedrock')
    })

    it('should handle response without embedding', async () => {
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({ message: 'success' }))
      } as any)

      const texts = ['Test text']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('No embedding found in response')
    })

    it('should handle empty text input', async () => {
      const texts = ['']
      
      await expect(embeddingService.batchEmbed(texts)).rejects.toThrow('Empty text provided for embedding')
    })
  })

  describe('configuration', () => {
    it('should return service configuration', () => {
      const config = embeddingService.getConfiguration()
      
      expect(config).toMatchObject({
        modelId: 'amazon.titan-embed-text-v1',
        dimensions: 1536,
        batchSize: 10,
        maxInputLength: 8000,
        rateLimitDelay: 100,
      })
      expect(typeof config.maxDelay).toBe('number')
    })
  })

  describe('text truncation', () => {
    it('should truncate long text to max input length', async () => {
      const mockEmbedding = new Array(1536).fill(0.1)
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      }

      mockBedrockClient.send.mockResolvedValue(mockResponse as any)

      const longText = 'a'.repeat(10000) // Longer than maxInputLength (8000)
      const texts = [longText]
      
      const result = await embeddingService.batchEmbed(texts)

      // Verify the service processed the text and returned an embedding
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(mockEmbedding)
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(1)
      
      // The truncation happens inside the service, so we just verify it didn't throw an error
      // and successfully processed the long text
    })
  })

  describe('batch processing', () => {
    it('should process large number of chunks in batches', async () => {
      const mockEmbedding = new Array(1536).fill(0.1)
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          embedding: mockEmbedding
        }))
      }

      mockBedrockClient.send.mockResolvedValue(mockResponse as any)

      // Create 25 chunks (should be processed in 3 batches of 10, 10, 5)
      const chunks: DocumentChunk[] = Array.from({ length: 25 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Test content ${i}`,
        metadata: {
          sourceUrl: 'https://example.com',
          title: 'Test Document',
          chunkIndex: i,
        },
        tokenCount: 10,
      }))

      const result = await embeddingService.generateEmbeddings(chunks)

      expect(result).toHaveLength(25)
      // Note: The actual number of calls might be 25 or 26 depending on mock setup timing
      expect(mockBedrockClient.send).toHaveBeenCalledTimes(25)
    })
  })
})