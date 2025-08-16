import { inngest } from '../inngest'
import { JobProcessor } from './processor'
import { jobQueue } from './queue'
import { WebScraper } from '../ingest/scraper'
import { ContentChunker } from '../ingest/chunker'
import { URLValidator } from '../ingest/validator'
import { EmbeddingService } from '../embed/service'
import { vectorStore } from '../vector/store'

// Initialize services
const webScraper = new WebScraper()
const contentChunker = new ContentChunker()
const urlValidator = new URLValidator()
const embeddingService = new EmbeddingService()

// Initialize job processor
const jobProcessor = new JobProcessor(
  webScraper,
  contentChunker,
  urlValidator,
  embeddingService,
  vectorStore,
  jobQueue,
  {
    maxProcessingTime: 300000, // 5 minutes
    enableProgressUpdates: true,
    batchSize: 10,
    maxRetries: 3
  }
)

/**
 * Inngest function to process ingestion jobs
 */
export const processIngestionJob = inngest.createFunction(
  { 
    id: 'process-ingestion-job',
    name: 'Process Document Ingestion Job',
    concurrency: {
      limit: 5 // Maximum 5 concurrent jobs
    },
    retries: 3,
    cancelOn: [
      {
        event: 'ingestion/job.cancelled',
        match: 'data.jobId'
      }
    ]
  },
  { event: 'ingestion/job.started' },
  async ({ event, step }) => {
    const { jobId, url, options } = event.data

    console.log(`Starting ingestion job ${jobId} for URL: ${url}`)

    try {
      // Process the job
      const result = await step.run('process-job', async () => {
        return await jobProcessor.processJob(jobId)
      })

      // Log results
      if (result.success) {
        console.log(`Job ${jobId} completed successfully: ${result.totalChunks} chunks processed in ${result.processingTime}ms`)
      } else {
        console.error(`Job ${jobId} failed with ${result.errors.length} errors:`, result.errors)
      }

      return result

    } catch (error) {
      console.error(`Job ${jobId} processing failed:`, error)
      
      // Ensure job is marked as failed
      await jobQueue.updateStatus(jobId, 'FAILED', error instanceof Error ? error.message : 'Unknown error')
      
      throw error
    }
  }
)

/**
 * Inngest function to handle job progress updates
 */
export const handleJobProgress = inngest.createFunction(
  {
    id: 'handle-job-progress',
    name: 'Handle Job Progress Updates'
  },
  { event: 'ingestion/job.progress' },
  async ({ event }) => {
    const { jobId, pagesProcessed, chunksCreated, chunksEmbedded, errors } = event.data
    
    console.log(`Job ${jobId} progress: ${pagesProcessed} pages, ${chunksCreated} chunks created, ${chunksEmbedded} chunks embedded, ${errors.length} errors`)
    
    // Here you could add additional logic like:
    // - Sending notifications
    // - Updating external systems
    // - Triggering webhooks
    
    return { acknowledged: true }
  }
)

/**
 * Inngest function to handle job completion
 */
export const handleJobCompletion = inngest.createFunction(
  {
    id: 'handle-job-completion',
    name: 'Handle Job Completion'
  },
  { event: 'ingestion/job.completed' },
  async ({ event }) => {
    const { jobId, success, totalChunks, errors } = event.data
    
    if (success) {
      console.log(`Job ${jobId} completed successfully with ${totalChunks} chunks`)
    } else {
      console.error(`Job ${jobId} failed with errors:`, errors)
    }
    
    // Here you could add additional logic like:
    // - Sending completion notifications
    // - Updating metrics
    // - Triggering follow-up processes
    
    return { acknowledged: true }
  }
)

/**
 * Inngest function to clean up old jobs (scheduled)
 */
export const cleanupOldJobs = inngest.createFunction(
  {
    id: 'cleanup-old-jobs',
    name: 'Cleanup Old Jobs'
  },
  { cron: '0 2 * * *' }, // Run daily at 2 AM
  async ({ step }) => {
    const deletedCount = await step.run('cleanup-jobs', async () => {
      return await jobQueue.cleanupOldJobs(30) // Delete jobs older than 30 days
    })
    
    console.log(`Cleaned up ${deletedCount} old jobs`)
    
    return { deletedCount }
  }
)

// Export all functions
export const ingestionFunctions = [
  processIngestionJob,
  handleJobProgress,
  handleJobCompletion,
  cleanupOldJobs
]