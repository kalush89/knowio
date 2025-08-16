import { prisma, dbMonitor } from '../db'
import { EmbeddedChunk, StorageResult } from '../types'
import { 
  VectorSearchOptions, 
  VectorSearchResult, 
  VectorUpsertResult, 
  VectorBatchResult,
  VectorStoreStats 
} from './types'
import { StorageError, ErrorSeverity } from '../errors'
import { metricsCollector } from '../monitoring/metrics'
import { loggers } from '../logger'

export class VectorStore {
  private readonly logger = loggers.vectorStore
  /**
   * Store a single embedded chunk in the vector database
   */
  async store(chunk: EmbeddedChunk): Promise<VectorUpsertResult> {
    try {
      // Check if chunk already exists by sourceUrl and chunkIndex
      const existing = await prisma.documentChunk.findFirst({
        where: {
          sourceUrl: chunk.metadata.sourceUrl,
          chunkIndex: chunk.metadata.chunkIndex
        }
      })

      if (existing) {
        // Update existing chunk using raw SQL for embedding field
        const embeddingVector = `[${chunk.embedding.join(',')}]`
        const metadata = JSON.stringify({
          ...chunk.metadata,
          embeddedAt: chunk.embeddedAt.toISOString()
        })
        
        await prisma.$executeRaw`
          UPDATE document_chunks 
          SET 
            content = ${chunk.content},
            title = ${chunk.metadata.title},
            section = ${chunk.metadata.section},
            token_count = ${chunk.tokenCount},
            embedding = ${embeddingVector}::vector,
            metadata = ${metadata}::jsonb,
            updated_at = NOW()
          WHERE id = ${existing.id}
        `

        return {
          id: existing.id,
          created: false,
          updated: true
        }
      } else {
        // Create new chunk using raw SQL for embedding field
        const embeddingVector = `[${chunk.embedding.join(',')}]`
        const metadata = JSON.stringify({
          ...chunk.metadata,
          embeddedAt: chunk.embeddedAt.toISOString()
        })
        
        await prisma.$executeRaw`
          INSERT INTO document_chunks (
            id, source_url, title, content, section, chunk_index, 
            token_count, embedding, metadata, created_at, updated_at
          ) VALUES (
            ${chunk.id}, ${chunk.metadata.sourceUrl}, ${chunk.metadata.title}, 
            ${chunk.content}, ${chunk.metadata.section}, ${chunk.metadata.chunkIndex},
            ${chunk.tokenCount}, ${embeddingVector}::vector, ${metadata}::jsonb,
            NOW(), NOW()
          )
        `

        return {
          id: chunk.id,
          created: true,
          updated: false
        }
      }
    } catch (error) {
      throw new StorageError(
        `Failed to store vector chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.HIGH,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Store multiple embedded chunks in batch with monitoring
   */
  async storeBatch(chunks: EmbeddedChunk[]): Promise<StorageResult> {
    return await dbMonitor.executeWithMonitoring(
      'vector_store_batch',
      async () => {
        const operationId = `vector_batch_${Date.now()}`
        metricsCollector.startTimer(operationId, { chunkCount: chunks.length })

        this.logger.info('Starting vector batch storage', {
          chunkCount: chunks.length
        })

        const results: VectorBatchResult = {
          successful: [],
          failed: [],
          totalProcessed: chunks.length
        }

        // Process in smaller batches for better performance monitoring
        const batchSize = 25
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize)
          const batchNumber = Math.floor(i / batchSize) + 1
          const totalBatches = Math.ceil(chunks.length / batchSize)

          this.logger.debug(`Processing vector storage batch ${batchNumber}/${totalBatches}`, {
            batchSize: batch.length
          })

          const batchStartTime = Date.now()
          
          for (const chunk of batch) {
            try {
              const result = await this.store(chunk)
              results.successful.push(result)
            } catch (error) {
              results.failed.push({
                chunk,
                error: error instanceof Error ? error.message : 'Unknown error'
              })
            }
          }

          const batchDuration = Date.now() - batchStartTime
          
          // Record batch metrics
          metricsCollector.recordDatabaseMetrics(
            'vector_store_sub_batch',
            batchDuration,
            batch.length,
            { 
              batch_number: batchNumber.toString(),
              batch_size: batch.length.toString()
            }
          )

          // Record memory usage periodically
          if (batchNumber % 5 === 0) {
            metricsCollector.recordMemoryUsage('vector_storage')
          }
        }

        const duration = metricsCollector.endTimer(operationId)
        const stored = results.successful.filter(r => r.created).length
        const updated = results.successful.filter(r => r.updated).length
        const failed = results.failed.length
        const successRate = Math.round(((stored + updated) / chunks.length) * 100)

        // Record overall metrics
        metricsCollector.recordMetric({
          name: 'vector_storage_success_rate',
          value: successRate,
          unit: 'percentage',
          timestamp: new Date(),
          tags: {
            total_chunks: chunks.length.toString(),
            stored: stored.toString(),
            updated: updated.toString(),
            failed: failed.toString()
          }
        })

        metricsCollector.recordProcessingSpeed(
          stored + updated,
          duration,
          { operation: 'vector_storage' }
        )

        this.logger.info('Vector batch storage completed', {
          stored,
          updated,
          failed,
          successRate,
          duration
        })

        return {
          stored,
          updated,
          failed,
          errors: results.failed.map(f => f.error)
        }
      }
    )
  }

  /**
   * Upsert a single chunk (insert or update)
   */
  async upsert(chunk: EmbeddedChunk): Promise<void> {
    await this.store(chunk)
  }

  /**
   * Perform vector similarity search
   */
  async search(
    queryEmbedding: number[], 
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const { 
      limit = 10, 
      threshold = 0.7, 
      includeMetadata = true 
    } = options

    try {
      // Use raw SQL for vector similarity search with pgvector
      const query = `
        SELECT 
          id,
          content,
          metadata,
          source_url as "sourceUrl",
          title,
          section,
          chunk_index as "chunkIndex",
          token_count as "tokenCount",
          1 - (embedding <=> $1::vector) as similarity
        FROM document_chunks
        WHERE 1 - (embedding <=> $1::vector) > $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `

      const embeddingVector = `[${queryEmbedding.join(',')}]`
      
      const results = await prisma.$queryRawUnsafe<Array<{
        id: string
        content: string
        metadata: any
        sourceUrl: string
        title: string
        section: string | null
        chunkIndex: number
        tokenCount: number
        similarity: number
      }>>(query, embeddingVector, threshold, limit)

      return results.map(row => ({
        id: row.id,
        content: row.content,
        metadata: includeMetadata ? row.metadata : {},
        similarity: row.similarity,
        sourceUrl: row.sourceUrl,
        title: row.title,
        section: row.section || undefined,
        chunkIndex: row.chunkIndex
      }))
    } catch (error) {
      throw new StorageError(
        `Vector search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.HIGH,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Delete all chunks from a specific source URL
   */
  async deleteBySource(sourceUrl: string): Promise<number> {
    try {
      const result = await prisma.documentChunk.deleteMany({
        where: { sourceUrl }
      })
      return result.count
    } catch (error) {
      throw new StorageError(
        `Failed to delete chunks by source: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.MEDIUM,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<VectorStoreStats> {
    try {
      const [totalChunks, uniqueSources, avgTokens, lastUpdated] = await Promise.all([
        prisma.documentChunk.count(),
        prisma.documentChunk.groupBy({
          by: ['sourceUrl'],
          _count: true
        }).then(groups => groups.length),
        prisma.documentChunk.aggregate({
          _avg: { tokenCount: true }
        }).then(result => result._avg.tokenCount || 0),
        prisma.documentChunk.findFirst({
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true }
        }).then(result => result?.updatedAt || new Date())
      ])

      return {
        totalChunks,
        uniqueSources,
        averageTokenCount: Math.round(avgTokens),
        lastUpdated
      }
    } catch (error) {
      throw new StorageError(
        `Failed to get vector store stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.LOW,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if the vector store is healthy and accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await prisma.documentChunk.count()
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get chunks by source URL with pagination
   */
  async getChunksBySource(
    sourceUrl: string, 
    page: number = 1, 
    pageSize: number = 50
  ): Promise<{
    chunks: VectorSearchResult[]
    total: number
    hasMore: boolean
  }> {
    try {
      const skip = (page - 1) * pageSize

      const [chunks, total] = await Promise.all([
        prisma.documentChunk.findMany({
          where: { sourceUrl },
          skip,
          take: pageSize,
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            content: true,
            metadata: true,
            sourceUrl: true,
            title: true,
            section: true,
            chunkIndex: true
          }
        }),
        prisma.documentChunk.count({
          where: { sourceUrl }
        })
      ])

      return {
        chunks: chunks.map(chunk => ({
          id: chunk.id,
          content: chunk.content,
          metadata: (chunk.metadata as Record<string, any>) || {},
          similarity: 1.0, // Not applicable for direct retrieval
          sourceUrl: chunk.sourceUrl,
          title: chunk.title,
          section: chunk.section || undefined,
          chunkIndex: chunk.chunkIndex
        })),
        total,
        hasMore: skip + pageSize < total
      }
    } catch (error) {
      throw new StorageError(
        `Failed to get chunks by source: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        ErrorSeverity.MEDIUM,
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const vectorStore = new VectorStore()