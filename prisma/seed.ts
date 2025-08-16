import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting database seeding...')

  // Check if we're in production - be more careful with seeding
  const isProduction = process.env.NODE_ENV === 'production'
  
  if (isProduction) {
    console.log('Production environment detected - skipping test data seeding')
    
    // Only create essential system data in production
    console.log('Creating system health check data...')
    
    // Create a system health check job to verify the system is working
    const healthCheckJob = await prisma.ingestionJob.upsert({
      where: { id: 'system-health-check' },
      update: {},
      create: {
        id: 'system-health-check',
        url: 'https://example.com/health-check',
        status: 'COMPLETED',
        progress: {
          pagesProcessed: 1,
          chunksCreated: 1,
          chunksEmbedded: 1,
          errors: []
        },
        options: {
          maxDepth: 1,
          followLinks: false,
          respectRobots: true
        },
        startedAt: new Date(),
        completedAt: new Date()
      }
    })
    
    console.log('System health check job created:', healthCheckJob.id)
    
  } else {
    console.log('Development environment detected - creating sample data...')
    
    // Create sample ingestion jobs for development
    const sampleJobs = [
      {
        id: 'sample-completed-job',
        url: 'https://docs.example.com/api',
        status: 'COMPLETED' as const,
        progress: {
          pagesProcessed: 5,
          chunksCreated: 25,
          chunksEmbedded: 25,
          errors: []
        },
        options: {
          maxDepth: 2,
          followLinks: true,
          respectRobots: true
        },
        startedAt: new Date(Date.now() - 3600000), // 1 hour ago
        completedAt: new Date(Date.now() - 3000000) // 50 minutes ago
      },
      {
        id: 'sample-failed-job',
        url: 'https://invalid-docs.example.com/api',
        status: 'FAILED' as const,
        progress: {
          pagesProcessed: 1,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: ['Failed to access URL: Connection timeout']
        },
        options: {
          maxDepth: 1,
          followLinks: false,
          respectRobots: true
        },
        errorMessage: 'Connection timeout after 30 seconds',
        startedAt: new Date(Date.now() - 1800000), // 30 minutes ago
        completedAt: new Date(Date.now() - 1740000) // 29 minutes ago
      }
    ]

    for (const job of sampleJobs) {
      await prisma.ingestionJob.upsert({
        where: { id: job.id },
        update: job,
        create: job
      })
      console.log(`Created sample job: ${job.id}`)
    }

    // Create sample document chunks for development
    const sampleChunks = [
      {
        id: 'sample-chunk-1',
        sourceUrl: 'https://docs.example.com/api/authentication',
        title: 'API Authentication',
        content: 'To authenticate with our API, you need to include an API key in the Authorization header. The API key should be prefixed with "Bearer ". Example: Authorization: Bearer your-api-key-here',
        section: 'Authentication',
        chunkIndex: 0,
        tokenCount: 45,
        embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1), // Random embedding for testing
        metadata: {
          pageTitle: 'API Authentication Guide',
          sectionHeaders: ['Authentication', 'Getting Started'],
          extractedAt: new Date().toISOString()
        }
      },
      {
        id: 'sample-chunk-2',
        sourceUrl: 'https://docs.example.com/api/endpoints',
        title: 'API Endpoints',
        content: 'Our API provides several endpoints for managing resources. The base URL is https://api.example.com/v1. All endpoints require authentication and return JSON responses.',
        section: 'Endpoints',
        chunkIndex: 0,
        tokenCount: 38,
        embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1), // Random embedding for testing
        metadata: {
          pageTitle: 'API Endpoints Reference',
          sectionHeaders: ['Endpoints', 'Reference'],
          extractedAt: new Date().toISOString()
        }
      }
    ]

    for (const chunk of sampleChunks) {
      // Note: We need to handle the vector type specially
      await prisma.$executeRaw`
        INSERT INTO document_chunks (
          id, "sourceUrl", title, content, section, "chunkIndex", 
          "tokenCount", embedding, metadata, "createdAt", "updatedAt"
        ) VALUES (
          ${chunk.id}, ${chunk.sourceUrl}, ${chunk.title}, ${chunk.content}, 
          ${chunk.section}, ${chunk.chunkIndex}, ${chunk.tokenCount}, 
          ${chunk.embedding}::vector, ${JSON.stringify(chunk.metadata)}::json,
          NOW(), NOW()
        ) ON CONFLICT (id) DO UPDATE SET
          "sourceUrl" = EXCLUDED."sourceUrl",
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          section = EXCLUDED.section,
          "chunkIndex" = EXCLUDED."chunkIndex",
          "tokenCount" = EXCLUDED."tokenCount",
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          "updatedAt" = NOW()
      `
      console.log(`Created sample chunk: ${chunk.id}`)
    }
  }

  console.log('Database seeding completed successfully!')
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })