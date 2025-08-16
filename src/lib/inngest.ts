import { Inngest } from 'inngest'

// Create the Inngest client
export const inngest = new Inngest({
  id: 'knowio',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

// Event types for type safety
export type IngestionJobEvent = {
  name: 'ingestion/job.started'
  data: {
    jobId: string
    url: string
    options: {
      maxDepth?: number
      followLinks?: boolean
      respectRobots?: boolean
    }
  }
}

export type IngestionProgressEvent = {
  name: 'ingestion/job.progress'
  data: {
    jobId: string
    pagesProcessed: number
    chunksCreated: number
    chunksEmbedded: number
    errors: string[]
  }
}

export type IngestionCompleteEvent = {
  name: 'ingestion/job.completed'
  data: {
    jobId: string
    success: boolean
    totalChunks: number
    errors: string[]
  }
}