// Core types for the document ingestion system

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  sanitizedUrl?: string
}

export interface PageMetadata {
  title: string
  description?: string
  author?: string
  publishedDate?: string
  section?: string
}

export interface ScrapedContent {
  url: string
  title: string
  content: string
  metadata: PageMetadata
  links: string[]
}

export interface ScrapingOptions {
  waitForSelector?: string
  timeout?: number
  userAgent?: string
  respectRobots?: boolean
}

export interface DocumentChunk {
  id: string
  content: string
  metadata: ChunkMetadata
  tokenCount: number
}

export interface ChunkMetadata {
  sourceUrl: string
  title: string
  section?: string
  pageNumber?: number
  chunkIndex: number
}

export interface EmbeddedChunk extends DocumentChunk {
  embedding: number[]
  embeddedAt: Date
}

export interface StorageResult {
  stored: number
  updated: number
  failed: number
  errors: string[]
}

export interface SearchResult {
  chunk: DocumentChunk
  similarity: number
}

export interface IngestionOptions {
  maxDepth?: number
  followLinks?: boolean
  respectRobots?: boolean
}

export interface JobProgress {
  pagesProcessed: number
  chunksCreated: number
  chunksEmbedded: number
  errors: string[]
}

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface IngestionJob {
  id: string
  url: string
  options: IngestionOptions
  status: JobStatus
  progress: JobProgress
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  errorMessage?: string
  userId?: string
  priority?: number
}

export interface TextProcessingOptions {
  maxTokens?: number
  preserveFormatting?: boolean
  removeHtml?: boolean
  splitSentences?: boolean
}

export interface TokenCountResult {
  count: number
  estimatedCost?: number
  warnings?: string[]
}

export interface TextQualityResult {
  isValid: boolean
  issues: string[]
  score?: number
  wordCount: number
  characterCount: number
}