-- Setup script for vector indexes
-- Run this script against your PostgreSQL database to set up vector search indexes

-- Add pgvector extension if not exists
CREATE EXTENSION IF NOT EXISTS vector;

-- Create vector similarity search index using IVFFlat
-- This index is optimized for cosine similarity searches
CREATE INDEX IF NOT EXISTS document_chunks_embedding_cosine_idx 
ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- Create additional indexes for efficient filtering
CREATE INDEX IF NOT EXISTS document_chunks_source_url_idx 
ON document_chunks (source_url);

CREATE INDEX IF NOT EXISTS document_chunks_created_at_idx 
ON document_chunks (created_at DESC);

-- Create composite index for source URL and chunk index (for upsert operations)
CREATE INDEX IF NOT EXISTS document_chunks_source_chunk_idx 
ON document_chunks (source_url, chunk_index);

-- Create partial index for recent chunks (performance optimization)
CREATE INDEX IF NOT EXISTS document_chunks_recent_idx 
ON document_chunks (created_at DESC) 
WHERE created_at > NOW() - INTERVAL '30 days';

-- Verify indexes were created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'document_chunks'
ORDER BY indexname;