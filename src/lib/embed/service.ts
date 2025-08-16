import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { bedrockRuntimeClient, EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS } from '../aws-config'
import { DocumentChunk, EmbeddedChunk } from '../types'
import { EmbeddingRequest, EmbeddingResponse, EmbeddingError, EmbeddingBatchResult } from './types'
import { EmbeddingError as IngestionEmbeddingError, ErrorContext, ErrorSeverity } from '../errors'
import { defaultErrorHandler } from '../error-handler'
import { loggers } from '../logger'
import { metricsCollector } from '../monitoring/metrics'
import { performanceMonitor } from '../monitoring/performance'
import { memoryManager } from '../monitoring/memory'

export class EmbeddingService {
  private readonly batchSize: number = 10
  private readonly maxInputLength: number = 8000
  private readonly rateLimitDelay: number = 100 // ms between requests
  private readonly logger = loggers.embedder

  constructor(options?: {
    batchSize?: number
    maxInputLength?: number
    rateLimitDelay?: number
  }) {
    if (options) {
      this.batchSize = options.batchSize ?? this.batchSize
      this.maxInputLength = options.maxInputLength ?? this.maxInputLength
      this.rateLimitDelay = options.rateLimitDelay ?? this.rateLimitDelay
    }
  }

  /**
   * Generate embeddings for document chunks with comprehensive error handling and monitoring
   */
  async generateEmbeddings(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]> {
    if (!chunks || chunks.length === 0) {
      return []
    }

    const context: ErrorContext = {
      component: 'EmbeddingService',
      operation: 'generateEmbeddings',
      timestamp: new Date(),
      metadata: { totalChunks: chunks.length }
    }

    const operationId = `embedding_generation_${Date.now()}`
    
    return await performanceMonitor.monitorResourceUsage(
      'embedding_generation',
      async () => {
        performanceMonitor.startProfiling(operationId, { 
          totalChunks: chunks.length,
          batchSize: this.batchSize 
        })

        this.logger.info('Starting embedding generation with monitoring', { 
          totalChunks: chunks.length,
          batchSize: this.batchSize 
        }, context)

        // Use memory-managed processing for large chunk sets
        return await memoryManager.optimizeForLargeDocuments(
          'embedding_generation',
          async ({ batchSize, shouldPause, memoryStatus }) => {
            const adaptiveBatchSize = Math.min(this.batchSize, batchSize)
            
            this.logger.info('Processing with adaptive batch size', {
              originalBatchSize: this.batchSize,
              adaptiveBatchSize,
              memoryStatus,
              shouldPause
            }, context)

            const embeddedChunks: EmbeddedChunk[] = []
            const errors: string[] = []
            
            // Process chunks in adaptive batches
            for (let i = 0; i < chunks.length; i += adaptiveBatchSize) {
              const batch = chunks.slice(i, i + adaptiveBatchSize)
              const batchNumber = Math.floor(i / adaptiveBatchSize) + 1
              const totalBatches = Math.ceil(chunks.length / adaptiveBatchSize)
              const batchContext = { 
                ...context, 
                batchNumber,
                metadata: { ...context.metadata, batchSize: batch.length }
              }
              
              try {
                this.logger.debug(`Processing embedding batch ${batchNumber}/${totalBatches}`, {
                  batchSize: batch.length,
                  memoryStatus
                }, batchContext)
                
                const batchStartTime = Date.now()
                const batchResult = await defaultErrorHandler.executeWithRetry(
                  () => this.processBatch(batch),
                  batchContext
                )
                const batchDuration = Date.now() - batchStartTime
                
                // Record API metrics
                metricsCollector.recordApiCall(
                  'aws_bedrock',
                  'embedding_batch',
                  batchDuration,
                  batchResult.errors.length === 0,
                  { batch_size: batch.length.toString() }
                )
                
                embeddedChunks.push(...batchResult.successful)
                
                if (batchResult.errors.length > 0) {
                  errors.push(...batchResult.errors)
                  this.logger.warn(`Batch ${batchNumber} had ${batchResult.errors.length} errors`, {
                    errorCount: batchResult.errors.length,
                    errors: batchResult.errors
                  }, batchContext)
                }
                
                // Record processing speed
                metricsCollector.recordProcessingSpeed(
                  batchResult.successful.length,
                  batchDuration,
                  { operation: 'embedding_batch' }
                )
                
                // Memory-aware delay between batches
                const delayMs = shouldPause ? this.rateLimitDelay * 2 : this.rateLimitDelay
                if (i + adaptiveBatchSize < chunks.length) {
                  await this.delay(delayMs)
                }
                
                // Check memory usage periodically
                if (batchNumber % 5 === 0) {
                  metricsCollector.recordMemoryUsage('embedding_batch')
                }
                
              } catch (error) {
                const errorResponse = await defaultErrorHandler.handleEmbeddingError(error, batchContext)
                errors.push(errorResponse.logMessage)
                
                // Record failed API call
                metricsCollector.recordApiCall(
                  'aws_bedrock',
                  'embedding_batch',
                  0,
                  false,
                  { batch_size: batch.length.toString(), error: 'batch_failed' }
                )
                
                // Continue with next batch instead of failing completely
                continue
              }
            }
            
            const successRate = chunks.length > 0 ? (embeddedChunks.length / chunks.length) * 100 : 0
            
            // Record final metrics
            metricsCollector.recordMetric({
              name: 'embedding_success_rate',
              value: successRate,
              unit: 'percentage',
              timestamp: new Date(),
              tags: { 
                total_chunks: chunks.length.toString(),
                successful_chunks: embeddedChunks.length.toString()
              }
            })
            
            if (errors.length > 0) {
              this.logger.warn(`Embedding generation completed with errors`, {
                totalChunks: chunks.length,
                successfulChunks: embeddedChunks.length,
                errorCount: errors.length,
                successRate: Math.round(successRate)
              }, context)
            } else {
              this.logger.info('Embedding generation completed successfully', {
                totalChunks: chunks.length,
                successfulChunks: embeddedChunks.length,
                successRate: 100
              }, context)
            }
            
            performanceMonitor.endProfiling(operationId, {
              successfulChunks: embeddedChunks.length,
              errorCount: errors.length,
              successRate: Math.round(successRate)
            })
            
            return embeddedChunks
          }
        )
      },
      { sampleInterval: 5000, trackCpu: true }
    )
  }

  /**
   * Process a batch of chunks with individual error handling
   */
  private async processBatch(chunks: DocumentChunk[]): Promise<EmbeddingBatchResult> {
    const successful: EmbeddedChunk[] = []
    const errors: string[] = []
    
    for (const chunk of chunks) {
      const chunkContext: ErrorContext = {
        component: 'EmbeddingService',
        operation: 'embedChunk',
        chunkId: chunk.id,
        timestamp: new Date(),
        metadata: { contentLength: chunk.content.length }
      }

      try {
        const embedding = await defaultErrorHandler.executeWithRetry(
          () => this.embedSingle(chunk.content),
          chunkContext
        )
        
        if (!this.validateEmbedding(embedding)) {
          throw new IngestionEmbeddingError(
            `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, got ${embedding?.length || 0}`,
            false,
            ErrorSeverity.HIGH,
            chunkContext
          )
        }
        
        successful.push({
          ...chunk,
          embedding,
          embeddedAt: new Date(),
        })
        
        // Small delay between individual requests within a batch
        await this.delay(50)
        
      } catch (error) {
        const errorResponse = await defaultErrorHandler.handleEmbeddingError(error, chunkContext)
        errors.push(errorResponse.logMessage)
      }
    }
    
    return { successful, errors }
  }

  /**
   * Generate embeddings for a batch of texts (public interface)
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return []
    }

    const context: ErrorContext = {
      component: 'EmbeddingService',
      operation: 'batchEmbed',
      timestamp: new Date(),
      metadata: { textCount: texts.length }
    }

    const embeddings: number[][] = []
    
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      const textContext = { 
        ...context, 
        metadata: { ...context.metadata, textIndex: i }
      }

      try {
        const embedding = await defaultErrorHandler.executeWithRetry(
          () => this.embedSingle(text),
          textContext
        )
        embeddings.push(embedding)
      } catch (error) {
        this.logger.error('Failed to embed text in batch', {
          textIndex: i,
          textLength: text.length
        }, textContext, error as Error)
        throw error
      }
    }
    
    return embeddings
  }



  /**
   * Generate embedding for a single text with performance monitoring
   */
  private async embedSingle(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new IngestionEmbeddingError(
        'Empty text provided for embedding',
        false,
        ErrorSeverity.LOW
      )
    }

    // Truncate text to maximum allowed length
    const truncatedText = text.substring(0, this.maxInputLength)
    const apiCallId = `embed_single_${Date.now()}`
    
    metricsCollector.startTimer(apiCallId, {
      textLength: truncatedText.length,
      modelId: EMBEDDING_MODEL_ID
    })
    
    try {
      const command = new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: truncatedText,
        }),
      })

      const response = await bedrockRuntimeClient.send(command)
      const duration = metricsCollector.endTimer(apiCallId, { success: 'true' })
      
      // Record successful API call metrics
      metricsCollector.recordApiCall(
        'aws_bedrock',
        'embedding_single',
        duration,
        true,
        { 
          text_length: truncatedText.length.toString(),
          model_id: EMBEDDING_MODEL_ID
        }
      )
      
      if (!response.body) {
        throw new IngestionEmbeddingError(
          'Empty response body from AWS Bedrock',
          true,
          ErrorSeverity.HIGH
        )
      }

      let responseBody: any
      try {
        responseBody = JSON.parse(new TextDecoder().decode(response.body))
      } catch (parseError) {
        throw new IngestionEmbeddingError(
          'Failed to parse response from AWS Bedrock',
          true,
          ErrorSeverity.HIGH,
          undefined,
          parseError as Error
        )
      }

      if (!responseBody.embedding) {
        throw new IngestionEmbeddingError(
          'No embedding found in response',
          true,
          ErrorSeverity.HIGH
        )
      }

      // Record embedding size metrics
      metricsCollector.recordMetric({
        name: 'embedding_dimensions',
        value: responseBody.embedding.length,
        unit: 'count',
        timestamp: new Date(),
        tags: { model_id: EMBEDDING_MODEL_ID }
      })

      return responseBody.embedding
    } catch (error) {
      const duration = metricsCollector.endTimer(apiCallId, { success: 'false' })
      
      // Record failed API call metrics
      metricsCollector.recordApiCall(
        'aws_bedrock',
        'embedding_single',
        duration,
        false,
        { 
          text_length: truncatedText.length.toString(),
          model_id: EMBEDDING_MODEL_ID,
          error_type: error instanceof Error ? error.constructor.name : 'unknown'
        }
      )
      
      // Re-throw IngestionEmbeddingError as-is
      if (error instanceof IngestionEmbeddingError) {
        throw error
      }

      // Handle AWS SDK errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase()
        
        if (message.includes('throttling') || message.includes('rate limit') || message.includes('429')) {
          throw new IngestionEmbeddingError(
            `AWS Bedrock rate limit exceeded: ${error.message}`,
            true,
            ErrorSeverity.MEDIUM,
            undefined,
            error
          )
        }

        if (message.includes('timeout') || message.includes('network') || message.includes('connection')) {
          throw new IngestionEmbeddingError(
            `Network error calling AWS Bedrock: ${error.message}`,
            true,
            ErrorSeverity.MEDIUM,
            undefined,
            error
          )
        }

        if (message.includes('unauthorized') || message.includes('access denied') || message.includes('403')) {
          throw new IngestionEmbeddingError(
            `AWS Bedrock access denied: ${error.message}`,
            false,
            ErrorSeverity.CRITICAL,
            undefined,
            error
          )
        }
      }

      // Generic error fallback
      throw new IngestionEmbeddingError(
        `Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.HIGH,
        undefined,
        error as Error
      )
    }
  }

  /**
   * Validate embedding dimensions and values
   */
  validateEmbedding(embedding: number[]): boolean {
    if (!Array.isArray(embedding)) {
      return false
    }
    
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      return false
    }
    
    // Check that all values are valid numbers
    return embedding.every(val => 
      typeof val === 'number' && 
      !isNaN(val) && 
      isFinite(val)
    )
  }



  /**
   * Utility function to add delay with promise
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get service configuration for monitoring/debugging
   */
  getConfiguration() {
    return {
      modelId: EMBEDDING_MODEL_ID,
      dimensions: EMBEDDING_DIMENSIONS,
      batchSize: this.batchSize,
      maxInputLength: this.maxInputLength,
      rateLimitDelay: this.rateLimitDelay,
    }
  }
}