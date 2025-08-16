-- Production database setup migration
-- This migration ensures all production-specific configurations are in place

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Create additional indexes for production performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_created_at_desc 
ON document_chunks ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_document_chunks_source_url_created_at 
ON document_chunks ("sourceUrl", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_created_at 
ON ingestion_jobs (status, "createdAt" DESC);

-- Create partial indexes for active jobs
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_active 
ON ingestion_jobs ("createdAt" DESC) 
WHERE status IN ('QUEUED', 'PROCESSING');

-- Add database-level constraints for data integrity
ALTER TABLE document_chunks 
ADD CONSTRAINT chk_token_count_positive 
CHECK ("tokenCount" > 0);

ALTER TABLE document_chunks 
ADD CONSTRAINT chk_chunk_index_non_negative 
CHECK ("chunkIndex" >= 0);

ALTER TABLE document_chunks 
ADD CONSTRAINT chk_source_url_format 
CHECK ("sourceUrl" ~ '^https?://');

-- Create function for automatic cleanup of old data
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
  -- Clean up completed jobs older than 30 days
  DELETE FROM ingestion_jobs 
  WHERE status = 'COMPLETED' 
    AND "completedAt" < NOW() - INTERVAL '30 days';
  
  -- Clean up failed jobs older than 7 days
  DELETE FROM ingestion_jobs 
  WHERE status = 'FAILED' 
    AND "createdAt" < NOW() - INTERVAL '7 days';
    
  -- Log cleanup activity
  RAISE NOTICE 'Cleanup completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Create scheduled cleanup (if pg_cron is available)
-- This would typically be set up by the DBA or deployment script
-- SELECT cron.schedule('cleanup-old-data', '0 2 * * *', 'SELECT cleanup_old_data();');

-- Create function to get database health statistics
CREATE OR REPLACE FUNCTION get_db_health_stats()
RETURNS TABLE (
  total_chunks bigint,
  total_jobs bigint,
  active_jobs bigint,
  avg_chunk_size numeric,
  db_size text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM document_chunks) as total_chunks,
    (SELECT COUNT(*) FROM ingestion_jobs) as total_jobs,
    (SELECT COUNT(*) FROM ingestion_jobs WHERE status IN ('QUEUED', 'PROCESSING')) as active_jobs,
    (SELECT AVG(length(content)) FROM document_chunks) as avg_chunk_size,
    pg_size_pretty(pg_database_size(current_database())) as db_size;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions for application user
-- Note: This assumes the application connects with a specific user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON document_chunks TO app_user;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ingestion_jobs TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;