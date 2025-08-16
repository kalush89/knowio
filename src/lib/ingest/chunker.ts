import { DocumentChunk, ChunkMetadata, PageMetadata } from '../types'
import { estimateTokenCount, preprocessText, splitIntoSentences } from '../utils'

export class ContentChunker {
  private readonly maxTokens: number
  private readonly overlapTokens: number
  private readonly minChunkSize: number

  constructor(maxTokens = 1000, overlapTokens = 100, minChunkSize = 50) {
    this.maxTokens = maxTokens
    this.overlapTokens = overlapTokens
    this.minChunkSize = minChunkSize
  }

  /**
   * Chunk content into smaller pieces suitable for embedding
   * Preserves semantic boundaries and document hierarchy
   */
  async chunk(content: string, metadata: PageMetadata): Promise<DocumentChunk[]> {
    // Preprocess the content to clean and normalize it
    const cleanContent = preprocessText(content)
    
    // Extract document structure (headers, sections, etc.)
    const structuredContent = this.extractDocumentStructure(cleanContent)
    
    // Process each section separately to maintain hierarchy
    const allChunks: DocumentChunk[] = []
    let globalChunkIndex = 0
    
    for (const section of structuredContent) {
      const sectionChunks = await this.chunkSection(section, metadata, globalChunkIndex)
      allChunks.push(...sectionChunks)
      globalChunkIndex += sectionChunks.length
    }
    
    // Apply overlap between chunks for better context preservation
    return this.addOverlapBetweenChunks(allChunks)
  }

  /**
   * Optimize chunk size based on token limits while preserving semantic boundaries
   */
  optimizeChunkSize(text: string, maxTokens: number): string[] {
    if (!text || text.trim().length === 0) {
      return []
    }
    
    const sentences = splitIntoSentences(text)
    if (sentences.length === 0) {
      return []
    }
    
    const chunks: string[] = []
    let currentChunk = ''
    
    for (const sentence of sentences) {
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence
      const tokenCount = estimateTokenCount(potentialChunk)
      
      if (tokenCount <= maxTokens) {
        currentChunk = potentialChunk
      } else {
        // Save current chunk if it has content
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim())
        }
        
        // Handle oversized sentences
        if (estimateTokenCount(sentence) > maxTokens) {
          const subChunks = this.splitOversizedSentence(sentence, maxTokens)
          chunks.push(...subChunks.filter(chunk => chunk.trim().length > 0))
          currentChunk = ''
        } else {
          currentChunk = sentence
        }
      }
    }
    
    // Add final chunk if it has content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }
    
    return chunks.filter(chunk => chunk.length > 0)
  }

  /**
   * Preserve context by creating DocumentChunk objects with proper metadata
   */
  preserveContext(chunks: string[], metadata: PageMetadata): DocumentChunk[] {
    return chunks.map((content, index) => this.createChunk(content, metadata, index))
  }

  /**
   * Extract document structure including headers and sections
   */
  private extractDocumentStructure(content: string): DocumentSection[] {
    const lines = content.split('\n')
    const sections: DocumentSection[] = []
    let currentSection: DocumentSection = {
      title: 'Main Content',
      level: 0,
      content: '',
      startIndex: 0
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      
      // Detect headers (markdown-style or common patterns)
      const markdownHeader = line.match(/^(#{1,6})\s+(.+)$/)
      const allCapsHeader = line.match(/^([A-Z][A-Z\s]{2,}):?\s*$/)
      const underlinedHeader = line.length > 0 && line.length < 100 && 
                              i + 1 < lines.length && 
                              lines[i + 1].match(/^[=-]{3,}$/)
      
      const headerMatch = markdownHeader || allCapsHeader || (underlinedHeader ? [null, '1', line] : null)
      
      if (headerMatch) {
        // Save previous section if it has content
        if (currentSection.content.trim()) {
          sections.push({ ...currentSection })
        }
        
        // Start new section
        const level = headerMatch[1] ? headerMatch[1].length : 1
        const title = headerMatch[2] || line
        
        currentSection = {
          title: title.trim(),
          level,
          content: '',
          startIndex: i
        }
        
        // Skip underline for underlined headers
        if (i + 1 < lines.length && lines[i + 1].match(/^[=-]{3,}$/)) {
          i++
        }
      } else if (line.length > 0) {
        currentSection.content += (currentSection.content ? '\n' : '') + line
      } else {
        currentSection.content += '\n'
      }
    }
    
    // Add final section
    if (currentSection.content.trim()) {
      sections.push(currentSection)
    }
    
    // If no sections were found, treat entire content as one section
    if (sections.length === 0) {
      sections.push({
        title: 'Main Content',
        level: 0,
        content: content,
        startIndex: 0
      })
    }
    
    return sections
  }

  /**
   * Chunk a single section while maintaining its context
   */
  private async chunkSection(
    section: DocumentSection, 
    metadata: PageMetadata, 
    startingIndex: number
  ): Promise<DocumentChunk[]> {
    const sectionMetadata: PageMetadata = {
      ...metadata,
      section: section.title
    }
    
    // If section is small enough, return as single chunk
    if (estimateTokenCount(section.content) <= this.maxTokens) {
      return [this.createChunk(section.content, sectionMetadata, startingIndex)]
    }
    
    // Split section into optimally sized chunks
    const optimizedChunks = this.optimizeChunkSize(section.content, this.maxTokens)
    
    // Create DocumentChunk objects with preserved context
    return optimizedChunks.map((content, index) => 
      this.createChunk(content, sectionMetadata, startingIndex + index)
    )
  }

  /**
   * Add overlap between chunks for better context preservation
   */
  private addOverlapBetweenChunks(chunks: DocumentChunk[]): DocumentChunk[] {
    if (chunks.length <= 1 || this.overlapTokens <= 0) {
      return chunks
    }
    
    const overlappedChunks: DocumentChunk[] = []
    
    for (let i = 0; i < chunks.length; i++) {
      const currentChunk = chunks[i]
      let enhancedContent = currentChunk.content
      
      // Add overlap from previous chunk (only at the beginning)
      if (i > 0) {
        const prevChunk = chunks[i - 1]
        const prevSentences = splitIntoSentences(prevChunk.content)
        const overlapText = this.getOverlapText(prevSentences.slice(-2), this.overlapTokens)
        
        if (overlapText) {
          enhancedContent = `${overlapText}\n\n${enhancedContent}`
        }
      }
      
      // Ensure the enhanced content doesn't exceed token limits
      if (estimateTokenCount(enhancedContent) > this.maxTokens) {
        enhancedContent = currentChunk.content // Fall back to original content
      }
      
      overlappedChunks.push({
        ...currentChunk,
        content: enhancedContent,
        tokenCount: estimateTokenCount(enhancedContent)
      })
    }
    
    return overlappedChunks
  }

  /**
   * Get overlap text that fits within token limit
   */
  private getOverlapText(sentences: string[], maxTokens: number): string {
    let overlapText = ''
    let tokenCount = 0
    
    for (const sentence of sentences) {
      const sentenceTokens = estimateTokenCount(sentence)
      if (tokenCount + sentenceTokens > maxTokens) {
        break
      }
      overlapText += (overlapText ? ' ' : '') + sentence
      tokenCount += sentenceTokens
    }
    
    return overlapText
  }

  /**
   * Split oversized sentences that exceed token limits
   */
  private splitOversizedSentence(sentence: string, maxTokens: number): string[] {
    const words = sentence.split(/\s+/)
    const chunks: string[] = []
    let currentChunk = ''
    
    for (const word of words) {
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + word
      
      if (estimateTokenCount(potentialChunk) <= maxTokens) {
        currentChunk = potentialChunk
      } else {
        if (currentChunk) {
          chunks.push(currentChunk)
        }
        currentChunk = word
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk)
    }
    
    return chunks
  }

  /**
   * Create a document chunk with metadata
   */
  private createChunk(content: string, metadata: PageMetadata, chunkIndex: number): DocumentChunk {
    const chunkMetadata: ChunkMetadata = {
      sourceUrl: '', // Will be set by the caller
      title: metadata.title,
      section: metadata.section,
      chunkIndex,
    }

    return {
      id: `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${chunkIndex}`,
      content: content.trim(),
      metadata: chunkMetadata,
      tokenCount: estimateTokenCount(content),
    }
  }
}

/**
 * Interface for document sections with hierarchy information
 */
interface DocumentSection {
  title: string
  level: number
  content: string
  startIndex: number
}