import { WebScraper } from '../ingest/scraper'
import { ContentChunker } from '../ingest/chunker'
import { URLValidator } from '../ingest/validator'
import { EmbeddingService } from '../embed/service'
import { VectorStore } from '../vector/store'
import { JobQueue, JobResult } from './queue'
import { 
  IngestionJob, 
  IngestionOptions, 
  ScrapedContent, 
  DocumentChunk, 
  EmbeddedChunk
} from '../types'
import { 
  JobError, 
  ValidationError, 
  ScrapingError, 
  EmbeddingError, 
  StorageError,
  ErrorContext,
  ErrorSeverity
} from '../errors'
import { ErrorHandler } from '../error-handler'
import { Logger, loggers } from '../logger'

export interface ProcessorOptions {
  maxProcessingTime?: number
  enableProgressUpdates?: boolean
  batchSize?: number
  maxRetries?: number
}

export class JobProcessor {
  private readonly webScraper: WebScraper
  private readonly contentChunker: ContentChunker
  private readonly urlValidator: URLValidator
  private readonly embeddingService: EmbeddingService
  private readonly vectorStore: VectorStore
  private readonly jobQueue: JobQueue
  private readonly maxProcessingTime: number
  private readonly enableProgressUpdates: boolean
  private readonly batchSize: number
  private readonly maxRetries: number
  private readonly errorHandler: ErrorHandler
  private readonly logger: Logger

  constructor(
    webScraper: WebScraper,
    contentChunker: ContentChunker,
    urlValidator: URLValidator,
    embeddingService: EmbeddingService,
    vectorStore: VectorStore,
    jobQueue: JobQueue,
    options: ProcessorOptions = {}
  ) {
    this.webScraper = webScraper
    this.contentChunker = contentChunker
    this.urlValidator = urlValidator
    this.embeddingService = embeddingService
    this.vectorStore = vectorStore
    this.jobQueue = jobQueue
    this.errorHandler = new ErrorHandler()
    this.logger = loggers.processor
    this.maxProcessingTime = options.maxProcessingTime ?? 300000 // 5 minutes
    this.enableProgressUpdates = options.enableProgressUpdates ?? true
    this.batchSize = options.batchSize ?? 10
    this.maxRetries = options.maxRetries ?? 3
  }

  /**
   * Process a single ingestion job with comprehensive error handling
   */
  async processJob(jobId: string): Promise<JobResult> {
    const context: ErrorContext = {
      jobId,
      component: 'JobProcessor',
      operation: 'processJob',
      timestamp: new Date()
    }

    return this.logger.measureAsync('processJob', async () => {
      const errors: string[] = []
      let totalChunks = 0

      try {
        // Get job details
        const job = await this.jobQueue.getStatus(jobId)
        if (!job) {
          throw new JobError(`Job ${jobId} not found`, false, ErrorSeverity.HIGH, context)
        }

        // Update context with job URL
        context.url = job.url

        this.logger.info('Starting job processing', {
          jobId,
          url: job.url,
          options: job.options
        }, context)

        // Update job status to processing
        await this.jobQueue.updateStatus(jobId, 'PROCESSING')

        // Execute job pipeline with timeout and error handling
        const result = await this.errorHandler.executeWithRetry(
          () => this.executeJobPipelineWithTimeout(job, context),
          context,
          { maxRetries: 0 } // No retries at job level, retries happen at operation level
        )

        totalChunks = result.totalChunks
        errors.push(...result.errors)

        // Complete the job
        const jobResult: JobResult = {
          success: errors.length === 0,
          totalChunks,
          errors,
          processingTime: Date.now() - context.timestamp.getTime()
        }

        await this.jobQueue.completeJob(jobId, jobResult)

        this.logger.info('Job processing completed', {
          jobId,
          success: jobResult.success,
          totalChunks,
          errorCount: errors.length,
          processingTime: jobResult.processingTime
        }, context)

        return jobResult

      } catch (error) {
        // Handle job-level errors
        const errorResponse = await this.errorHandler.handleError(error, context)
        errors.push(errorResponse.logMessage)
        
        this.logger.error('Job processing failed', {
          jobId,
          error: errorResponse,
          totalChunks,
          errorCount: errors.length
        }, context, error as Error)

        // Mark job as failed
        const jobResult: JobResult = {
          success: false,
          totalChunks,
          errors,
          processingTime: Date.now() - context.timestamp.getTime()
        }

        try {
          await this.jobQueue.completeJob(jobId, jobResult)
        } catch (completionError) {
          this.logger.error('Failed to mark job as completed', {
            jobId,
            originalError: errorResponse.logMessage
          }, context, completionError as Error)
        }

        return jobResult
      }
    }, context)
  }

  /**
   * Execute job pipeline with timeout protection
   */
  private async executeJobPipelineWithTimeout(
    job: IngestionJob,
    context: ErrorContext
  ): Promise<{ totalChunks: number; errors: string[] }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new JobError(
          `Job processing timeout after ${this.maxProcessingTime}ms`,
          false,
          ErrorSeverity.HIGH,
          context
        ))
      }, this.maxProcessingTime)
    })

    return Promise.race([
      this.executeJobPipeline(job, context),
      timeoutPromise
    ])
  }

  /**
   * Execute the complete job processing pipeline with comprehensive error handling
   */
  private async executeJobPipeline(
    job: IngestionJob, 
    context: ErrorContext
  ): Promise<{ totalChunks: number; errors: string[] }> {
    let totalChunks = 0
    const pipelineErrors: string[] = []

    try {
      // Step 1: Validate URL
      const validationContext = { ...context, operation: 'validateUrl' }
      this.logger.info('Step 1: Validating URL', { url: job.url }, validationContext)
      
      const validationResult = await this.errorHandler.executeWithRetry(
        () => this.validateUrl(job.url),
        validationContext
      )
      
      if (!validationResult.isValid) {
        throw new ValidationError(
          `URL validation failed: ${validationResult.errors.join(', ')}`,
          validationContext
        )
      }

      const sanitizedUrl = validationResult.sanitizedUrl || job.url

      // Step 2: Scrape content
      const scrapingContext = { ...context, operation: 'scrapeContent', url: sanitizedUrl }
      this.logger.info('Step 2: Scraping content', { url: sanitizedUrl }, scrapingContext)
      
      const scrapedContent = await this.errorHandler.executeWithRetry(
        () => this.scrapeContent(sanitizedUrl, job.options),
        scrapingContext
      )
      
      if (this.enableProgressUpdates) {
        await this.jobQueue.updateProgress(job.id, {
          pagesProcessed: 1
        })
      }

      // Step 3: Chunk content
      const chunkingContext = { ...context, operation: 'chunkContent' }
      this.logger.info('Step 3: Chunking content', { 
        contentLength: scrapedContent.content.length 
      }, chunkingContext)
      
      const chunks = await this.errorHandler.executeWithRetry(
        () => this.chunkContent(scrapedContent),
        chunkingContext
      )
      totalChunks = chunks.length
      
      if (this.enableProgressUpdates) {
        await this.jobQueue.updateProgress(job.id, {
          chunksCreated: chunks.length
        })
      }

      // Step 4: Generate embeddings with graceful degradation
      const embeddingContext = { ...context, operation: 'generateEmbeddings' }
      this.logger.info('Step 4: Generating embeddings', { 
        chunkCount: chunks.length 
      }, embeddingContext)
      
      const embeddedChunks = await this.errorHandler.handleWithGracefulDegradation(
        () => this.generateEmbeddings(chunks, job.id),
        () => this.generateEmbeddingsWithFallback(chunks, job.id),
        embeddingContext
      )
      
      if (this.enableProgressUpdates) {
        await this.jobQueue.updateProgress(job.id, {
          chunksEmbedded: embeddedChunks.length
        })
      }

      // Step 5: Store in vector database
      const storageContext = { ...context, operation: 'storeEmbeddings' }
      this.logger.info('Step 5: Storing embedded chunks', { 
        chunkCount: embeddedChunks.length 
      }, storageContext)
      
      const storageResult = await this.errorHandler.executeWithRetry(
        () => this.storeEmbeddings(embeddedChunks),
        storageContext
      )
      
      if (storageResult.errors.length > 0) {
        pipelineErrors.push(...storageResult.errors)
        this.logger.warn('Storage completed with errors', {
          stored: storageResult.stored,
          updated: storageResult.updated,
          failed: storageResult.failed,
          errors: storageResult.errors
        }, storageContext)
      }

      this.logger.info('Pipeline completed successfully', {
        stored: storageResult.stored,
        updated: storageResult.updated,
        failed: storageResult.failed,
        totalChunks: storageResult.stored + storageResult.updated
      }, context)

      return {
        totalChunks: storageResult.stored + storageResult.updated,
        errors: pipelineErrors
      }

    } catch (error) {
      const errorResponse = await this.errorHandler.handleError(error, context)
      pipelineErrors.push(errorResponse.logMessage)
      
      // Update progress with error
      if (this.enableProgressUpdates) {
        try {
          await this.jobQueue.updateProgress(job.id, {
            errors: [errorResponse.userMessage]
          })
        } catch (progressError) {
          this.logger.error('Failed to update progress with error', {
            originalError: errorResponse.logMessage
          }, context, progressError as Error)
        }
      }

      return {
        totalChunks,
        errors: pipelineErrors
      }
    }
  }

  /**
   * Validate URL (now handled by ErrorHandler retry logic)
   */
  private async validateUrl(url: string): Promise<{ isValid: boolean; errors: string[]; sanitizedUrl?: string }> {
    try {
      return await this.urlValidator.validate(url)
    } catch (error) {
      throw new ValidationError(
        `URL validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error as Error
      )
    }
  }

  /**
   * Scrape content (now handled by ErrorHandler retry logic)
   */
  private async scrapeContent(url: string, options: IngestionOptions): Promise<ScrapedContent> {
    try {
      return await this.webScraper.scrape(url, {
        respectRobots: options.respectRobots ?? true,
        timeout: 30000
      })
    } catch (error) {
      throw new ScrapingError(
        `Content scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.MEDIUM,
        undefined,
        error as Error
      )
    }
  }

  /**
   * Chunk content
   */
  private async chunkContent(scrapedContent: ScrapedContent): Promise<DocumentChunk[]> {
    try {
      return await this.contentChunker.chunk(scrapedContent.content, scrapedContent.metadata)
    } catch (error) {
      throw new JobError(
        `Content chunking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        false,
        ErrorSeverity.MEDIUM,
        undefined,
        error as Error
      )
    }
  }

  /**
   * Generate embeddings with progress updates and error handling
   */
  private async generateEmbeddings(chunks: DocumentChunk[], jobId: string): Promise<EmbeddedChunk[]> {
    try {
      return await this.embeddingService.generateEmbeddings(chunks)
    } catch (error) {
      throw new EmbeddingError(
        `Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.MEDIUM,
        undefined,
        error as Error
      )
    }
  }

  /**
   * Fallback embedding generation with reduced batch size
   */
  private async generateEmbeddingsWithFallback(chunks: DocumentChunk[], jobId: string): Promise<EmbeddedChunk[]> {
    this.logger.warn('Using fallback embedding generation with reduced batch size', {
      originalChunkCount: chunks.length,
      fallbackBatchSize: Math.max(1, Math.floor(this.batchSize / 2))
    })

    const embeddedChunks: EmbeddedChunk[] = []
    const batchErrors: string[] = []
    const fallbackBatchSize = Math.max(1, Math.floor(this.batchSize / 2))

    // Process chunks in smaller batches
    for (let i = 0; i < chunks.length; i += fallbackBatchSize) {
      const batch = chunks.slice(i, i + fallbackBatchSize)
      const batchNumber = Math.floor(i / fallbackBatchSize) + 1
      const totalBatches = Math.ceil(chunks.length / fallbackBatchSize)
      
      try {
        const batchEmbedded = await this.embeddingService.generateEmbeddings(batch)
        embeddedChunks.push(...batchEmbedded)
        
        this.logger.debug('Fallback batch processed successfully', {
          batchNumber,
          totalBatches,
          batchSize: batch.length,
          totalProcessed: embeddedChunks.length
        })
        
        // Update progress
        if (this.enableProgressUpdates) {
          await this.jobQueue.updateProgress(jobId, {
            chunksEmbedded: embeddedChunks.length
          })
        }
        
      } catch (error) {
        const errorMessage = `Fallback batch ${batchNumber} embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        batchErrors.push(errorMessage)
        this.logger.error('Fallback batch failed', {
          batchNumber,
          error: errorMessage
        })
        
        // Continue with next batch for partial success
        continue
      }
    }

    if (embeddedChunks.length === 0) {
      throw new EmbeddingError(
        `All fallback embedding batches failed: ${batchErrors.join('; ')}`,
        false,
        ErrorSeverity.HIGH
      )
    }

    if (batchErrors.length > 0) {
      this.logger.warn('Fallback embedding completed with partial success', {
        successfulChunks: embeddedChunks.length,
        totalChunks: chunks.length,
        failedBatches: batchErrors.length,
        errors: batchErrors
      })
    }

    return embeddedChunks
  }

  /**
   * Store embeddings in vector database
   */
  private async storeEmbeddings(embeddedChunks: EmbeddedChunk[]): Promise<{
    stored: number
    updated: number
    failed: number
    errors: string[]
  }> {
    try {
      return await this.vectorStore.storeBatch(embeddedChunks)
    } catch (error) {
      throw new StorageError(
        `Vector storage failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.HIGH,
        undefined,
        error as Error
      )
    }
  }
}