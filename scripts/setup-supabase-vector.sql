-- Supabase Vector Storage Setup Script
-- Run this script in your Supabase SQL editor to set up vector search capabilities

-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify the extension is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Create vector similarity search index using IVFFlat (if not exists)
-- This index is optimized for cosine similarity searches
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'document_chunks' 
        AND indexname = 'document_chunks_embedding_cosine_idx'
    ) THEN
        CREATE INDEX document_chunks_embedding_cosine_idx 
        ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
        WITH (lists = 100);
    END IF;
END $$;

-- Create additional indexes for efficient filtering (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'document_chunks' 
        AND indexname = 'document_chunks_source_url_idx'
    ) THEN
        CREATE INDEX document_chunks_source_url_idx 
        ON document_chunks (source_url);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'document_chunks' 
        AND indexname = 'document_chunks_created_at_idx'
    ) THEN
        CREATE INDEX document_chunks_created_at_idx 
        ON document_chunks (created_at DESC);
    END IF;
END $$;

-- Create composite index for source URL and chunk index (for upsert operations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'document_chunks' 
        AND indexname = 'document_chunks_source_chunk_idx'
    ) THEN
        CREATE INDEX document_chunks_source_chunk_idx 
        ON document_chunks (source_url, chunk_index);
    END IF;
END $$;

-- Create partial index for recent chunks (performance optimization)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'document_chunks' 
        AND indexname = 'document_chunks_recent_idx'
    ) THEN
        CREATE INDEX document_chunks_recent_idx 
        ON document_chunks (created_at DESC) 
        WHERE created_at > NOW() - INTERVAL '30 days';
    END IF;
END $$;

-- Verify all indexes were created
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'document_chunks'
ORDER BY indexname;

-- Test vector operations (optional)
-- This will verify that vector operations work correctly
DO $$
DECLARE
    test_embedding vector(1536);
BEGIN
    -- Create a test embedding
    test_embedding := array_fill(0.1, ARRAY[1536])::vector;
    
    -- Test vector operations
    RAISE NOTICE 'Vector extension is working correctly!';
    RAISE NOTICE 'Test embedding dimensions: %', array_length(test_embedding::real[], 1);
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error testing vector operations: %', SQLERRM;
END $$;