// Vector storage types and interfaces

export interface VectorSearchOptions {
  limit?: number
  threshold?: number
  includeMetadata?: boolean
}

export interface VectorSearchResult {
  id: string
  content: string
  metadata: Record<string, any>
  similarity: number
  sourceUrl: string
  title: string
  section?: string
  chunkIndex: number
}

export interface VectorUpsertResult {
  id: string
  created: boolean
  updated: boolean
}

export interface VectorBatchResult {
  successful: VectorUpsertResult[]
  failed: Array<{
    chunk: any
    error: string
  }>
  totalProcessed: number
}

export interface VectorStoreStats {
  totalChunks: number
  uniqueSources: number
  averageTokenCount: number
  lastUpdated: Date
}