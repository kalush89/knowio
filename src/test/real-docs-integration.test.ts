import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as ingestPost } from '../app/api/ingest-url/route'
import { GET as statusGet } from '../app/api/ingest-status/[jobId]/route'
import { JobProcessor } from '../lib/jobs/processor'
import { WebScraper } from '../lib/ingest/scraper'
import { ContentChunker } from '../lib/ingest/chunker'
import { URLValidator } from '../lib/ingest/validator'
import { EmbeddingService } from '../lib/embed/service'
import { VectorStore } from '../lib/vector/store'
import { JobQueue } from '../lib/jobs/queue'
import { prisma } from '../lib/db'

// Mock real documentation content for testing
const MOCK_DOCUMENTATION_SITES = {
  'https://docs.stripe.com/api': {
    title: 'Stripe API Documentation',
    content: `
# Stripe API Reference

## Authentication
The Stripe API uses API keys to authenticate requests. You can view and manage your API keys in the Stripe Dashboard.

Your API keys carry many privileges, so be sure to keep them secure! Do not share your secret API keys in publicly accessible areas such as GitHub, client-side code, and so forth.

## Making Requests
All API requests must be made over HTTPS. Calls made over plain HTTP will fail. API requests without authentication will also fail.

## Errors
Stripe uses conventional HTTP response codes to indicate the success or failure of an API request. In general: Codes in the 2xx range indicate success. Codes in the 4xx range indicate an error that failed given the information provided. Codes in the 5xx range indicate an error with Stripe's servers.

## Rate Limiting
The Stripe API has rate limits to ensure the stability of the service. If you exceed the rate limit, you'll receive a 429 Too Many Requests response.
    `,
    metadata: {
      title: 'Stripe API Documentation',
      description: 'Complete reference for the Stripe API',
      section: 'API Reference'
    }
  },
  'https://docs.github.com/en/rest': {
    title: 'GitHub REST API Documentation',
    content: `
# GitHub REST API

## About the REST API
You can use the GitHub REST API to create integrations, retrieve data, and automate your workflows.

## Getting Started
To get started with the GitHub REST API, you'll need to authenticate your requests and understand the basic concepts.

### Authentication
You can authenticate to the GitHub API using personal access tokens, GitHub Apps, or OAuth Apps.

### Making Requests
All API requests should be made to https://api.github.com. All requests must include a User-Agent header.

### Rate Limiting
The GitHub API has rate limits to prevent abuse. Different authentication methods have different rate limits.

## Repositories
The Repositories API allows you to create, read, update, and delete repositories on GitHub.

### List Repositories
GET /user/repos - List repositories for the authenticated user
GET /users/{username}/repos - List public repositories for a user
GET /orgs/{org}/repos - List repositories for an organization
    `,
    metadata: {
      title: 'GitHub REST API Documentation',
      description: 'Complete reference for the GitHub REST API',
      section: 'REST API'
    }
  },
  'https://docs.aws.amazon.com/bedrock/': {
    title: 'Amazon Bedrock Documentation',
    content: `
# Amazon Bedrock User Guide

## What is Amazon Bedrock?
Amazon Bedrock is a fully managed service that offers a choice of high-performing foundation models (FMs) from leading AI companies like AI21 Labs, Anthropic, Cohere, Meta, Stability AI, and Amazon via a single API.

## Getting Started
To get started with Amazon Bedrock, you need to set up your AWS account and configure the necessary permissions.

### Prerequisites
- An AWS account
- Appropriate IAM permissions
- AWS CLI configured (optional)

### Model Access
Before you can use foundation models in Amazon Bedrock, you need to request access to them in the AWS console.

## Foundation Models
Amazon Bedrock provides access to various foundation models for different use cases:

### Text Generation Models
- Anthropic Claude models for conversational AI
- AI21 Labs Jurassic models for text completion
- Cohere Command models for instruction following

### Embedding Models
- Amazon Titan Text Embeddings for semantic search
- Cohere Embed models for text embeddings

## API Reference
The Amazon Bedrock API provides operations for invoking foundation models and managing model access.

### InvokeModel
Invokes the specified Bedrock model to run inference using the input provided.

### InvokeModelWithResponseStream
Invokes the specified Bedrock model to run inference using the input provided with streaming response.
    `,
    metadata: {
      title: 'Amazon Bedrock Documentation',
      description: 'User guide for Amazon Bedrock foundation models',
      section: 'User Guide'
    }
  }
}

describe('Real Documentation Integration Tests', () => {
  let jobQueue: JobQueue
  let processor: JobProcessor
  let webScraper: WebScraper
  let contentChunker: ContentChunker
  let urlValidator: URLValidator
  let embeddingService: EmbeddingService
  let vectorStore: VectorStore

  beforeEach(async () => {
    // Clean up test data
    await prisma.documentChunk.deleteMany({
      where: {
        sourceUrl: {
          in: Object.keys(MOCK_DOCUMENTATION_SITES)
        }
      }
    })

    await prisma.ingestionJob.deleteMany({
      where: {
        url: {
          in: Object.keys(MOCK_DOCUMENTATION_SITES)
        }
      }
    })

    // Initialize services
    jobQueue = new JobQueue({
      maxRetries: 2,
      retryDelay: 100,
      maxConcurrentJobs: 3,
      jobTimeout: 15000
    })

    webScraper = new WebScraper()
    contentChunker = new ContentChunker()
    urlValidator = new URLValidator()
    embeddingService = new EmbeddingService()
    vectorStore = new VectorStore()

    processor = new JobProcessor(
      webScraper,
      contentChunker,
      urlValidator,
      embeddingService,
      vectorStore,
      jobQueue,
      {
        maxProcessingTime: 15000,
        enableProgressUpdates: true,
        batchSize: 5,
        maxRetries: 2
      }
    )

    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up after each test
    await prisma.documentChunk.deleteMany({
      where: {
        sourceUrl: {
          in: Object.keys(MOCK_DOCUMENTATION_SITES)
        }
      }
    })

    await prisma.ingestionJob.deleteMany({
      where: {
        url: {
          in: Object.keys(MOCK_DOCUMENTATION_SITES)
        }
      }
    })

    vi.resetAllMocks()
  })

  describe('Stripe API Documentation Ingestion', () => {
    it('should successfully ingest and process Stripe API documentation', async () => {
      const stripeUrl = 'https://docs.stripe.com/api'
      const mockData = MOCK_DOCUMENTATION_SITES[stripeUrl]

      // Mock services for Stripe documentation
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: stripeUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: stripeUrl,
        title: mockData.title,
        content: mockData.content,
        metadata: mockData.metadata,
        links: []
      })

      // Generate realistic chunks for Stripe documentation
      const stripeChunks = [
        {
          id: 'stripe-chunk-1',
          content: 'The Stripe API uses API keys to authenticate requests. You can view and manage your API keys in the Stripe Dashboard. Your API keys carry many privileges, so be sure to keep them secure!',
          metadata: {
            sourceUrl: stripeUrl,
            title: 'Stripe API Documentation',
            section: 'Authentication',
            chunkIndex: 0
          },
          tokenCount: 45
        },
        {
          id: 'stripe-chunk-2',
          content: 'All API requests must be made over HTTPS. Calls made over plain HTTP will fail. API requests without authentication will also fail.',
          metadata: {
            sourceUrl: stripeUrl,
            title: 'Stripe API Documentation',
            section: 'Making Requests',
            chunkIndex: 1
          },
          tokenCount: 32
        },
        {
          id: 'stripe-chunk-3',
          content: 'Stripe uses conventional HTTP response codes to indicate the success or failure of an API request. Codes in the 2xx range indicate success. Codes in the 4xx range indicate an error.',
          metadata: {
            sourceUrl: stripeUrl,
            title: 'Stripe API Documentation',
            section: 'Errors',
            chunkIndex: 2
          },
          tokenCount: 38
        },
        {
          id: 'stripe-chunk-4',
          content: 'The Stripe API has rate limits to ensure the stability of the service. If you exceed the rate limit, you\'ll receive a 429 Too Many Requests response.',
          metadata: {
            sourceUrl: stripeUrl,
            title: 'Stripe API Documentation',
            section: 'Rate Limiting',
            chunkIndex: 3
          },
          tokenCount: 35
        }
      ]

      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(stripeChunks)

      const embeddedChunks = stripeChunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: stripeChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Submit ingestion request
      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: stripeUrl,
          options: {
            maxDepth: 1,
            followLinks: false,
            respectRobots: true
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      expect(response.status).toBe(202)
      expect(jobId).toBeDefined()

      // Process the job
      const result = await processor.processJob(jobId)

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(stripeChunks.length)
      expect(result.errors).toHaveLength(0)

      // Verify chunks were processed correctly
      expect(contentChunker.chunk).toHaveBeenCalledWith(
        mockData.content,
        mockData.metadata
      )

      // Verify embeddings were generated
      expect(embeddingService.generateEmbeddings).toHaveBeenCalledWith(stripeChunks)

      // Verify storage
      expect(vectorStore.storeBatch).toHaveBeenCalledWith(embeddedChunks)

      // Check final status
      const statusRequest = new NextRequest(`http://localhost:3000/api/ingest-status/${jobId}`)
      const statusResponse = await statusGet(statusRequest, { params: { jobId } })
      const statusData = await statusResponse.json()

      expect(statusResponse.status).toBe(200)
      expect(statusData.status).toBe('completed')
      expect(statusData.progress.chunksCreated).toBe(stripeChunks.length)
      expect(statusData.progress.chunksEmbedded).toBe(stripeChunks.length)
    })
  })

  describe('GitHub API Documentation Ingestion', () => {
    it('should successfully ingest and process GitHub API documentation', async () => {
      const githubUrl = 'https://docs.github.com/en/rest'
      const mockData = MOCK_DOCUMENTATION_SITES[githubUrl]

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: githubUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: githubUrl,
        title: mockData.title,
        content: mockData.content,
        metadata: mockData.metadata,
        links: []
      })

      // Generate realistic chunks for GitHub documentation
      const githubChunks = [
        {
          id: 'github-chunk-1',
          content: 'You can use the GitHub REST API to create integrations, retrieve data, and automate your workflows. To get started with the GitHub REST API, you\'ll need to authenticate your requests.',
          metadata: {
            sourceUrl: githubUrl,
            title: 'GitHub REST API Documentation',
            section: 'Getting Started',
            chunkIndex: 0
          },
          tokenCount: 42
        },
        {
          id: 'github-chunk-2',
          content: 'You can authenticate to the GitHub API using personal access tokens, GitHub Apps, or OAuth Apps. All API requests should be made to https://api.github.com.',
          metadata: {
            sourceUrl: githubUrl,
            title: 'GitHub REST API Documentation',
            section: 'Authentication',
            chunkIndex: 1
          },
          tokenCount: 35
        },
        {
          id: 'github-chunk-3',
          content: 'The Repositories API allows you to create, read, update, and delete repositories on GitHub. GET /user/repos lists repositories for the authenticated user.',
          metadata: {
            sourceUrl: githubUrl,
            title: 'GitHub REST API Documentation',
            section: 'Repositories',
            chunkIndex: 2
          },
          tokenCount: 38
        }
      ]

      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(githubChunks)

      const embeddedChunks = githubChunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: githubChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: githubUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(githubChunks.length)

      // Verify the content was processed correctly
      expect(webScraper.scrape).toHaveBeenCalledWith(githubUrl, expect.any(Object))
      expect(contentChunker.chunk).toHaveBeenCalledWith(
        mockData.content,
        mockData.metadata
      )
    })
  })

  describe('Amazon Bedrock Documentation Ingestion', () => {
    it('should successfully ingest and process Amazon Bedrock documentation', async () => {
      const bedrockUrl = 'https://docs.aws.amazon.com/bedrock/'
      const mockData = MOCK_DOCUMENTATION_SITES[bedrockUrl]

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: bedrockUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: bedrockUrl,
        title: mockData.title,
        content: mockData.content,
        metadata: mockData.metadata,
        links: []
      })

      // Generate realistic chunks for Bedrock documentation
      const bedrockChunks = [
        {
          id: 'bedrock-chunk-1',
          content: 'Amazon Bedrock is a fully managed service that offers a choice of high-performing foundation models from leading AI companies like AI21 Labs, Anthropic, Cohere, Meta, Stability AI, and Amazon via a single API.',
          metadata: {
            sourceUrl: bedrockUrl,
            title: 'Amazon Bedrock Documentation',
            section: 'What is Amazon Bedrock?',
            chunkIndex: 0
          },
          tokenCount: 48
        },
        {
          id: 'bedrock-chunk-2',
          content: 'To get started with Amazon Bedrock, you need to set up your AWS account and configure the necessary permissions. Before you can use foundation models, you need to request access to them in the AWS console.',
          metadata: {
            sourceUrl: bedrockUrl,
            title: 'Amazon Bedrock Documentation',
            section: 'Getting Started',
            chunkIndex: 1
          },
          tokenCount: 45
        },
        {
          id: 'bedrock-chunk-3',
          content: 'Amazon Bedrock provides access to various foundation models: Anthropic Claude models for conversational AI, AI21 Labs Jurassic models for text completion, and Amazon Titan Text Embeddings for semantic search.',
          metadata: {
            sourceUrl: bedrockUrl,
            title: 'Amazon Bedrock Documentation',
            section: 'Foundation Models',
            chunkIndex: 2
          },
          tokenCount: 42
        },
        {
          id: 'bedrock-chunk-4',
          content: 'The Amazon Bedrock API provides operations for invoking foundation models. InvokeModel runs inference using the input provided, while InvokeModelWithResponseStream provides streaming response.',
          metadata: {
            sourceUrl: bedrockUrl,
            title: 'Amazon Bedrock Documentation',
            section: 'API Reference',
            chunkIndex: 3
          },
          tokenCount: 38
        }
      ]

      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(bedrockChunks)

      const embeddedChunks = bedrockChunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: bedrockChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: bedrockUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(bedrockChunks.length)

      // Verify specific Bedrock content was processed
      expect(contentChunker.chunk).toHaveBeenCalledWith(
        expect.stringContaining('Amazon Bedrock is a fully managed service'),
        expect.objectContaining({
          title: 'Amazon Bedrock Documentation'
        })
      )
    })
  })

  describe('Multiple Documentation Sites Concurrent Processing', () => {
    it('should handle concurrent ingestion of multiple real documentation sites', async () => {
      const urls = Object.keys(MOCK_DOCUMENTATION_SITES)

      // Mock services for all URLs
      vi.spyOn(urlValidator, 'validate').mockImplementation(async (url) => ({
        isValid: true,
        errors: [],
        sanitizedUrl: url
      }))

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => {
        const mockData = MOCK_DOCUMENTATION_SITES[url as keyof typeof MOCK_DOCUMENTATION_SITES]
        return {
          url,
          title: mockData.title,
          content: mockData.content,
          metadata: mockData.metadata,
          links: []
        }
      })

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => {
        // Generate 3-4 chunks per site
        const numChunks = Math.floor(Math.random() * 2) + 3 // 3 or 4 chunks
        return Array.from({ length: numChunks }, (_, i) => ({
          id: `chunk-${metadata.sourceUrl}-${i}`,
          content: `Chunk ${i + 1} from ${metadata.title}: ${content.substring(i * 100, (i + 1) * 100)}`,
          metadata: {
            sourceUrl: metadata.sourceUrl || 'unknown',
            title: metadata.title || 'Unknown',
            section: `Section ${i + 1}`,
            chunkIndex: i
          },
          tokenCount: 30 + Math.floor(Math.random() * 20)
        }))
      })

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        chunks.map(chunk => ({
          ...chunk,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
          embeddedAt: new Date()
        }))
      )

      vi.spyOn(vectorStore, 'storeBatch').mockImplementation(async (chunks) => ({
        stored: chunks.length,
        updated: 0,
        failed: 0,
        errors: []
      }))

      // Submit all ingestion requests concurrently
      const ingestPromises = urls.map(url => {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({ url }),
          headers: { 'Content-Type': 'application/json' }
        })
        return ingestPost(request)
      })

      const responses = await Promise.all(ingestPromises)
      const jobIds = await Promise.all(
        responses.map(response => response.json().then(data => data.jobId))
      )

      // Process all jobs concurrently
      const processingPromises = jobIds.map(jobId => processor.processJob(jobId))
      const results = await Promise.all(processingPromises)

      // Verify all jobs completed successfully
      results.forEach((result, index) => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBeGreaterThan(0)
        expect(result.errors).toHaveLength(0)
      })

      // Verify all documentation sites were processed
      expect(webScraper.scrape).toHaveBeenCalledTimes(urls.length)
      urls.forEach(url => {
        expect(webScraper.scrape).toHaveBeenCalledWith(url, expect.any(Object))
      })

      // Verify chunks were created for all sites
      const totalStoredChunks = await prisma.documentChunk.count({
        where: {
          sourceUrl: {
            in: urls
          }
        }
      })

      expect(totalStoredChunks).toBeGreaterThan(0)

      // Verify job completion status for all jobs
      const statusPromises = jobIds.map(async (jobId) => {
        const statusRequest = new NextRequest(`http://localhost:3000/api/ingest-status/${jobId}`)
        const statusResponse = await statusGet(statusRequest, { params: { jobId } })
        return statusResponse.json()
      })

      const statusResults = await Promise.all(statusPromises)
      statusResults.forEach(statusData => {
        expect(statusData.status).toBe('completed')
        expect(statusData.progress.chunksCreated).toBeGreaterThan(0)
        expect(statusData.progress.chunksEmbedded).toBeGreaterThan(0)
      })
    })
  })

  describe('Real Documentation Error Scenarios', () => {
    it('should handle documentation site with access restrictions', async () => {
      const restrictedUrl = 'https://docs.stripe.com/api'

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: restrictedUrl
      })

      // Mock scraper to simulate access restriction
      vi.spyOn(webScraper, 'scrape').mockRejectedValue(
        new Error('HTTP 403: Access forbidden - requires authentication')
      )

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: restrictedUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.errors.some(error => 
        error.includes('Access forbidden') || error.includes('403')
      )).toBe(true)

      // Verify job failed with appropriate error
      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      expect(job?.status).toBe('FAILED')
      expect(job?.errorMessage).toContain('Access forbidden')
    })

    it('should handle documentation site with rate limiting', async () => {
      const rateLimitedUrl = 'https://docs.github.com/en/rest'

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: rateLimitedUrl
      })

      // Mock scraper to simulate rate limiting on first attempt, success on retry
      let attemptCount = 0
      vi.spyOn(webScraper, 'scrape').mockImplementation(async () => {
        attemptCount++
        if (attemptCount === 1) {
          throw new Error('HTTP 429: Rate limit exceeded - retry after 60 seconds')
        }
        return MOCK_DOCUMENTATION_SITES[rateLimitedUrl]
      })

      const mockChunks = [
        {
          id: 'rate-limit-chunk-1',
          content: 'GitHub API documentation content after rate limit retry',
          metadata: {
            sourceUrl: rateLimitedUrl,
            title: 'GitHub REST API Documentation',
            section: 'Rate Limiting Recovery',
            chunkIndex: 0
          },
          tokenCount: 25
        }
      ]

      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(mockChunks)

      const embeddedChunks = mockChunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: mockChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: rateLimitedUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      // Should succeed after retry
      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(mockChunks.length)
      expect(webScraper.scrape).toHaveBeenCalledTimes(2) // Failed once, succeeded on retry

      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      expect(job?.status).toBe('COMPLETED')
    })
  })
})