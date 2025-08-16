-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "progress" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_sourceUrl_idx" ON "document_chunks"("sourceUrl");

-- CreateIndex
CREATE INDEX "document_chunks_sourceUrl_chunkIndex_idx" ON "document_chunks"("sourceUrl", "chunkIndex");

-- CreateIndex
CREATE INDEX "document_chunks_createdAt_idx" ON "document_chunks"("createdAt" DESC);

-- Create vector similarity search index using IVFFlat
-- This index is optimized for cosine similarity searches
CREATE INDEX "document_chunks_embedding_cosine_idx" 
ON "document_chunks" USING ivfflat ("embedding" vector_cosine_ops) 
WITH (lists = 100);

-- Create partial index for recent chunks (performance optimization)
-- Note: Using a static date instead of NOW() to make it immutable
CREATE INDEX "document_chunks_recent_idx" 
ON "document_chunks" ("createdAt" DESC);