# Supabase Vector Storage Setup Guide

This guide walks you through setting up the vector storage layer with Supabase PostgreSQL.

## Prerequisites

1. **Supabase Project**: You need an active Supabase project
2. **Database Access**: Admin access to your Supabase database
3. **Environment Variables**: Your Supabase connection strings

## Step 1: Configure Environment Variables

Update your `.env.local` file with your Supabase credentials:

```bash
# Connect to Supabase via connection pooling
DATABASE_URL="postgresql://postgres.npqleszhozzhixamkkvs:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Direct connection to the database. Used for migrations
DIRECT_URL="postgresql://postgres.npqleszhozzhixamkkvs:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

**Important**: Replace `[YOUR-PASSWORD]` with your actual Supabase database password.

## Step 2: Enable pgvector Extension

In your Supabase dashboard:

1. Go to **SQL Editor**
2. Run the following command to enable the vector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

3. Verify the extension is installed:

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

## Step 3: Run Database Migrations

From your project root, run the Prisma migrations:

```bash
# Generate Prisma client
npx prisma generate

# Apply migrations to create tables and indexes
npx prisma migrate deploy
```

If you encounter issues, you can also run:

```bash
# Push schema changes directly
npx prisma db push
```

## Step 4: Set Up Vector Indexes

Run the Supabase-specific setup script in your SQL Editor:

1. Copy the contents of `scripts/setup-supabase-vector.sql`
2. Paste and execute in Supabase SQL Editor
3. Verify all indexes were created successfully

The script will:
- Enable the pgvector extension
- Create optimized vector similarity indexes
- Set up composite indexes for efficient queries
- Create partial indexes for performance optimization

## Step 5: Verify Setup

Run the test suite to verify everything is working:

```bash
# Run vector storage tests
npm test -- src/lib/vector --run

# Run integration verification
npm test -- src/lib/vector/__tests__/integration-verification.test.ts --run
```

## Step 6: Test Vector Operations

You can test vector operations directly in Supabase SQL Editor:

```sql
-- Test vector similarity search
SELECT 
    id,
    content,
    1 - (embedding <=> '[0.1,0.2,0.3,...]'::vector) as similarity
FROM document_chunks
WHERE 1 - (embedding <=> '[0.1,0.2,0.3,...]'::vector) > 0.7
ORDER BY embedding <=> '[0.1,0.2,0.3,...]'::vector
LIMIT 5;
```

## Performance Optimization

### Index Configuration

The setup creates several indexes for optimal performance:

1. **IVFFlat Vector Index**: For cosine similarity searches
   ```sql
   CREATE INDEX document_chunks_embedding_cosine_idx 
   ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
   WITH (lists = 100);
   ```

2. **Composite Indexes**: For efficient filtering and upserts
3. **Partial Indexes**: For recent data optimization

### Connection Pooling

Supabase provides connection pooling through PgBouncer:
- Use `DATABASE_URL` (port 6543) for application connections
- Use `DIRECT_URL` (port 5432) for migrations and admin operations

### Memory Considerations

- Each 1536-dimensional vector uses ~6KB of storage
- IVFFlat index performs best with 1000+ vectors
- Consider batch operations for large datasets

## Troubleshooting

### Common Issues

1. **Extension Not Found**
   ```
   Error: extension "vector" is not available
   ```
   **Solution**: Enable the pgvector extension in Supabase dashboard under Extensions.

2. **Migration Failures**
   ```
   Error: relation "document_chunks" does not exist
   ```
   **Solution**: Run `npx prisma migrate deploy` or `npx prisma db push`.

3. **Connection Issues**
   ```
   Error: Can't reach database server
   ```
   **Solution**: Verify your DATABASE_URL and DIRECT_URL are correct.

4. **Vector Operations Fail**
   ```
   Error: operator does not exist: vector <=>
   ```
   **Solution**: Ensure pgvector extension is properly installed.

### Debugging Steps

1. **Check Extension Status**:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```

2. **Verify Tables Exist**:
   ```sql
   \dt document_chunks
   ```

3. **Check Indexes**:
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'document_chunks';
   ```

4. **Test Connection**:
   ```bash
   npx prisma db pull
   ```

## Security Considerations

1. **Environment Variables**: Never commit actual passwords to version control
2. **Connection Strings**: Use environment variables for all database connections
3. **Row Level Security**: Consider enabling RLS in Supabase for production
4. **API Keys**: Secure your Supabase API keys appropriately

## Monitoring

### Database Metrics

Monitor these metrics in Supabase dashboard:
- Connection count
- Query performance
- Index usage
- Storage usage

### Application Metrics

Use the vector store's built-in monitoring:

```typescript
import { vectorStore } from '@/lib/vector'

// Health check
const isHealthy = await vectorStore.healthCheck()

// Statistics
const stats = await vectorStore.getStats()
console.log(`Total chunks: ${stats.totalChunks}`)
console.log(`Unique sources: ${stats.uniqueSources}`)
```

## Next Steps

After successful setup:

1. **Test the ingestion pipeline** with real documentation URLs
2. **Configure AWS Bedrock** for embedding generation
3. **Set up background job processing** with Inngest
4. **Implement the chat API** for similarity search
5. **Add monitoring and alerting** for production use

## Support

If you encounter issues:
1. Check the Supabase documentation for pgvector
2. Review the Prisma documentation for PostgreSQL
3. Check the project's GitHub issues
4. Contact the development team