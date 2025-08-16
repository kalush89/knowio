# Vector Storage Module

This module provides a comprehensive vector storage layer for the document ingestion system, built on top of PostgreSQL with the pgvector extension.

## Features

- **Vector Storage**: Store and manage document chunks with their vector embeddings
- **Similarity Search**: Perform efficient cosine similarity searches using pgvector
- **Upsert Operations**: Handle duplicate content intelligently with update/insert logic
- **Batch Processing**: Store multiple chunks efficiently in batch operations
- **Statistics**: Get insights into the vector store usage and performance
- **Health Monitoring**: Check database connectivity and system health

## Components

### VectorStore Class

The main class that provides all vector storage operations:

```typescript
import { VectorStore, vectorStore } from '@/lib/vector'

// Use the singleton instance
const results = await vectorStore.search(queryEmbedding, { limit: 10 })

// Or create a new instance
const customStore = new VectorStore()
```

### Key Methods

#### `store(chunk: EmbeddedChunk): Promise<VectorUpsertResult>`
Store a single embedded chunk. Automatically handles upserts based on sourceUrl and chunkIndex.

#### `storeBatch(chunks: EmbeddedChunk[]): Promise<StorageResult>`
Store multiple chunks in batch for better performance.

#### `search(queryEmbedding: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>`
Perform vector similarity search with configurable options:
- `limit`: Maximum number of results (default: 10)
- `threshold`: Minimum similarity score (default: 0.7)
- `includeMetadata`: Include chunk metadata in results (default: true)

#### `deleteBySource(sourceUrl: string): Promise<number>`
Delete all chunks from a specific source URL.

#### `getStats(): Promise<VectorStoreStats>`
Get statistics about the vector store including total chunks, unique sources, and average token count.

## Database Schema

The vector storage uses the `document_chunks` table with the following structure:

```sql
CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  section TEXT,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Indexes

The module creates several indexes for optimal performance:

1. **Vector Similarity Index**: IVFFlat index for cosine similarity searches
2. **Source URL Index**: For filtering by source
3. **Composite Index**: For efficient upsert operations (source_url, chunk_index)
4. **Temporal Index**: For time-based queries
5. **Partial Index**: For recent chunks optimization

## Setup

1. **Install pgvector extension**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. **Run the setup script**:
   ```bash
   psql -d your_database -f scripts/setup-vector-indexes.sql
   ```

3. **Configure your database connection** in `.env.local`:
   ```
   DATABASE_URL="postgresql://username:password@localhost:5432/knowio?schema=public"
   ```

## Usage Examples

### Basic Storage and Search

```typescript
import { vectorStore } from '@/lib/vector'
import { EmbeddedChunk } from '@/lib/types'

// Store a chunk
const chunk: EmbeddedChunk = {
  id: 'chunk-1',
  content: 'API authentication using JWT tokens',
  metadata: {
    sourceUrl: 'https://docs.example.com/auth',
    title: 'Authentication Guide',
    section: 'JWT Tokens',
    chunkIndex: 0
  },
  tokenCount: 25,
  embedding: [0.1, 0.2, 0.3, ...], // 1536-dimensional vector
  embeddedAt: new Date()
}

await vectorStore.store(chunk)

// Search for similar content
const queryEmbedding = [0.15, 0.25, 0.35, ...] // Query vector
const results = await vectorStore.search(queryEmbedding, {
  limit: 5,
  threshold: 0.8
})

console.log(`Found ${results.length} similar chunks`)
results.forEach(result => {
  console.log(`${result.title}: ${result.similarity.toFixed(3)}`)
})
```

### Batch Operations

```typescript
// Store multiple chunks efficiently
const chunks: EmbeddedChunk[] = [
  // ... array of chunks
]

const result = await vectorStore.storeBatch(chunks)
console.log(`Stored: ${result.stored}, Updated: ${result.updated}, Failed: ${result.failed}`)
```

### Statistics and Monitoring

```typescript
// Get vector store statistics
const stats = await vectorStore.getStats()
console.log(`Total chunks: ${stats.totalChunks}`)
console.log(`Unique sources: ${stats.uniqueSources}`)
console.log(`Average tokens: ${stats.averageTokenCount}`)

// Health check
const isHealthy = await vectorStore.healthCheck()
if (!isHealthy) {
  console.error('Vector store is not accessible')
}
```

## Error Handling

The module uses the `StorageError` class for all error conditions:

```typescript
import { StorageError } from '@/lib/errors'

try {
  await vectorStore.store(chunk)
} catch (error) {
  if (error instanceof StorageError) {
    console.error(`Storage error: ${error.message}`)
    if (error.retryable) {
      // Implement retry logic
    }
  }
}
```

## Performance Considerations

1. **Batch Operations**: Use `storeBatch()` for multiple chunks to reduce database round trips
2. **Index Maintenance**: The IVFFlat index performs best with at least 1000 vectors
3. **Search Thresholds**: Higher thresholds (0.8+) return more relevant results but fewer matches
4. **Memory Usage**: Large embeddings (1536 dimensions) require significant memory for operations

## Testing

The module includes comprehensive unit tests:

```bash
npm test -- src/lib/vector/__tests__/store.unit.test.ts --run
```

Tests cover:
- Storage operations (create/update)
- Batch processing
- Vector similarity search
- Error handling
- Statistics and health checks

## Integration with Other Modules

The vector storage integrates with:
- **Embedding Service**: Receives `EmbeddedChunk` objects from the embedding pipeline
- **Content Chunker**: Stores processed document chunks
- **Search API**: Provides similarity search for user queries
- **Job Processing**: Handles background ingestion tasks