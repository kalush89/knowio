// Embedding service types

export interface EmbeddingRequest {
  texts: string[]
  modelId?: string
}

export interface EmbeddingResponse {
  embeddings: number[][]
  modelId: string
  usage: {
    totalTokens: number
  }
}

export interface EmbeddingError {
  code: string
  message: string
  retryable: boolean
  retryAfter?: number
}

export interface EmbeddingBatchResult {
  successful: import('../types').EmbeddedChunk[]
  errors: string[]
}

export interface EmbeddingServiceConfig {
  modelId: string
  dimensions: number
  maxRetries: number
  batchSize: number
  maxInputLength: number
  baseDelay: number
  maxDelay: number
}