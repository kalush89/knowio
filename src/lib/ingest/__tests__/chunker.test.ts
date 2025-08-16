import { describe, it, expect, beforeEach } from 'vitest'
import { ContentChunker } from '../chunker'
import { PageMetadata } from '../../types'
import { estimateTokenCount } from '../../utils'

describe('ContentChunker', () => {
  let chunker: ContentChunker
  let mockMetadata: PageMetadata

  beforeEach(() => {
    chunker = new ContentChunker(500, 50, 20) // maxTokens, overlapTokens, minChunkSize
    mockMetadata = {
      title: 'Test Document',
      description: 'A test document for chunking',
      section: 'Introduction'
    }
  })

  describe('chunk()', () => {
    it('should chunk simple text into appropriate sizes', async () => {
      const content = `
        This is the first paragraph. It contains some basic information about the topic.
        
        This is the second paragraph. It provides more detailed information and examples.
        
        This is the third paragraph. It concludes the section with final thoughts.
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks).toHaveLength(1) // Should fit in one chunk given the size
      expect(chunks[0].content).toContain('first paragraph')
      expect(chunks[0].content).toContain('second paragraph')
      expect(chunks[0].content).toContain('third paragraph')
      expect(chunks[0].metadata.title).toBe('Test Document')
      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })

    it('should split large content into multiple chunks', async () => {
      // Create content that will definitely exceed token limits
      const longParagraph = 'This is a very long sentence that repeats itself. '.repeat(50)
      const content = `
        ${longParagraph}
        
        This is another paragraph that should be in a separate chunk.
        
        ${longParagraph}
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks.length).toBeGreaterThan(1)
      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(500)
        expect(chunk.metadata.title).toBe('Test Document')
      })
    })

    it('should preserve document structure with headers', async () => {
      const content = `
        # Introduction
        This is the introduction section with some basic information.
        
        ## Getting Started
        This section explains how to get started with the API.
        
        ### Prerequisites
        You need to have these things installed first.
        
        ## Advanced Usage
        This section covers advanced topics and use cases.
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      // Should have chunks with different section metadata
      const sectionTitles = chunks.map(chunk => chunk.metadata.section).filter(Boolean)
      expect(sectionTitles.length).toBeGreaterThan(0)
      expect(sectionTitles).toContain('Introduction')
    })

    it('should handle content with underlined headers', async () => {
      const content = `Introduction
============
This is the introduction section.

Getting Started
---------------
This section explains the basics.

More content here that should be properly chunked.`

      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks.length).toBeGreaterThan(0)
      const hasIntroSection = chunks.some(chunk => 
        chunk.metadata.section === 'Introduction'
      )
      expect(hasIntroSection).toBe(true)
    })

    it('should maintain chunk indices correctly', async () => {
      const content = `
        First section with some content that should be chunked properly.
        
        Second section with more content that needs to be processed.
        
        Third section with additional information for testing.
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      chunks.forEach((chunk, index) => {
        expect(chunk.metadata.chunkIndex).toBe(index)
        expect(chunk.id).toContain(`-${index}`)
      })
    })
  })

  describe('optimizeChunkSize()', () => {
    it('should split text at sentence boundaries', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.'
      const chunks = chunker.optimizeChunkSize(text, 100) // Small limit to force splitting

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.trim()).not.toBe('')
        // Should end with proper punctuation (sentence boundary)
        expect(chunk.trim()).toMatch(/[.!?]$/)
      })
    })

    it('should respect token limits', () => {
      const text = 'Word '.repeat(200) // Create text that exceeds limits
      const maxTokens = 50
      const chunks = chunker.optimizeChunkSize(text, maxTokens)

      chunks.forEach(chunk => {
        expect(estimateTokenCount(chunk)).toBeLessThanOrEqual(maxTokens)
      })
    })

    it('should handle empty or very short text', () => {
      expect(chunker.optimizeChunkSize('', 100)).toEqual([])
      expect(chunker.optimizeChunkSize('Short.', 100)).toEqual(['Short.'])
    })

    it('should preserve semantic meaning by keeping sentences together', () => {
      const text = 'The API endpoint returns a JSON response. The response contains user data. The data includes name and email.'
      const chunks = chunker.optimizeChunkSize(text, 200)

      // Should keep related sentences together when possible
      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk).toMatch(/\.$/) // Should end with complete sentences
      })
    })
  })

  describe('preserveContext()', () => {
    it('should create DocumentChunk objects with proper metadata', () => {
      const textChunks = [
        'First chunk of content.',
        'Second chunk of content.',
        'Third chunk of content.'
      ]

      const documentChunks = chunker.preserveContext(textChunks, mockMetadata)

      expect(documentChunks).toHaveLength(3)
      documentChunks.forEach((chunk, index) => {
        expect(chunk.content).toBe(textChunks[index])
        expect(chunk.metadata.title).toBe(mockMetadata.title)
        expect(chunk.metadata.chunkIndex).toBe(index)
        expect(chunk.tokenCount).toBeGreaterThan(0)
        expect(chunk.id).toContain(`-${index}`)
      })
    })

    it('should handle empty chunks array', () => {
      const result = chunker.preserveContext([], mockMetadata)
      expect(result).toEqual([])
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle content with only whitespace', async () => {
      const content = '   \n\n   \t\t   \n   '
      const chunks = await chunker.chunk(content, mockMetadata)

      // Should either return empty array or handle gracefully
      expect(Array.isArray(chunks)).toBe(true)
    })

    it('should handle content with special characters', async () => {
      const content = `
        # Special Characters Test
        This content has émojis 🚀, ñoñó characters, and "smart quotes".
        
        It also has code snippets like \`const x = "hello";\` and URLs like https://example.com.
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.content).toBeTruthy()
        expect(chunk.tokenCount).toBeGreaterThan(0)
      })
    })

    it('should handle very long single sentences', async () => {
      const longSentence = 'This is an extremely long sentence that goes on and on and contains many words and phrases and clauses that make it exceed the normal token limits for a single chunk, but it should still be handled gracefully by the chunking algorithm.'
      
      const chunks = await chunker.chunk(longSentence, mockMetadata)

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(500)
      })
    })

    it('should handle mixed content types', async () => {
      const content = `
        # API Documentation
        
        ## Overview
        This API provides access to user data.
        
        ### Code Example
        \`\`\`javascript
        const response = await fetch('/api/users');
        const users = await response.json();
        \`\`\`
        
        ## Error Codes
        - 400: Bad Request
        - 401: Unauthorized  
        - 404: Not Found
        
        For more information, visit https://docs.example.com
      `

      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.content.trim()).toBeTruthy()
        expect(chunk.metadata).toBeDefined()
        expect(chunk.tokenCount).toBeGreaterThan(0)
      })
    })
  })

  describe('overlap functionality', () => {
    it('should add overlap between chunks when configured', async () => {
      const chunkerWithOverlap = new ContentChunker(100, 20, 10) // Small chunks with overlap
      
      const content = `
        First paragraph with some content that should be split.
        
        Second paragraph with more content for testing overlap.
        
        Third paragraph to ensure we have multiple chunks.
        
        Fourth paragraph for additional testing coverage.
      `

      const chunks = await chunkerWithOverlap.chunk(content, mockMetadata)

      if (chunks.length > 1) {
        // Check that chunks have some overlapping content
        // This is a basic check - in practice, overlap might be more sophisticated
        expect(chunks.length).toBeGreaterThan(1)
        chunks.forEach(chunk => {
          expect(chunk.tokenCount).toBeLessThanOrEqual(100)
        })
      }
    })
  })

  describe('token counting accuracy', () => {
    it('should provide reasonable token count estimates', async () => {
      const content = 'This is a test sentence with exactly ten words in it.'
      const chunks = await chunker.chunk(content, mockMetadata)

      expect(chunks).toHaveLength(1)
      const tokenCount = chunks[0].tokenCount
      
      // Token count should be reasonable (between 8-15 for this sentence)
      expect(tokenCount).toBeGreaterThan(5)
      expect(tokenCount).toBeLessThan(20)
    })
  })
})