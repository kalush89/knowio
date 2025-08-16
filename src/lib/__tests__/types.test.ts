import { describe, it, expect } from 'vitest'
import type {
  ValidationResult,
  PageMetadata,
  ScrapedContent,
  DocumentChunk,
  ChunkMetadata,
  EmbeddedChunk,
  StorageResult,
  SearchResult,
  IngestionOptions,
  JobProgress,
  JobStatus,
  IngestionJob,
  TextProcessingOptions,
  TokenCountResult,
  TextQualityResult
} from '../types'

describe('Type Definitions', () => {
  describe('ValidationResult', () => {
    it('should have correct structure for valid result', () => {
      const result: ValidationResult = {
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com'
      }
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.sanitizedUrl).toBe('https://example.com')
    })

    it('should have correct structure for invalid result', () => {
      const result: ValidationResult = {
        isValid: false,
        errors: ['Invalid URL format']
      }
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Invalid URL format')
      expect(result.sanitizedUrl).toBeUndefined()
    })
  })

  describe('DocumentChunk', () => {
    it('should have correct structure', () => {
      const chunk: DocumentChunk = {
        id: 'chunk-123',
        content: 'This is test content',
        metadata: {
          sourceUrl: 'https://example.com',
          title: 'Test Page',
          chunkIndex: 0
        },
        tokenCount: 5
      }
      
      expect(chunk.id).toBe('chunk-123')
      expect(chunk.content).toBe('This is test content')
      expect(chunk.tokenCount).toBe(5)
      expect(chunk.metadata.sourceUrl).toBe('https://example.com')
    })
  })
})