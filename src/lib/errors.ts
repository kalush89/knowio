// Comprehensive error handling and logging utilities for the ingestion system

// ============================================================================
// Error Types and Classes
// ============================================================================

export enum ErrorCategory {
  VALIDATION = 'VALIDATION',
  SCRAPING = 'SCRAPING',
  EMBEDDING = 'EMBEDDING',
  STORAGE = 'STORAGE',
  JOB = 'JOB',
  NETWORK = 'NETWORK',
  RATE_LIMIT = 'RATE_LIMIT',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ErrorContext {
  jobId?: string
  url?: string
  chunkId?: string
  batchNumber?: number
  attempt?: number
  timestamp: Date
  component: string
  operation: string
  metadata?: Record<string, any>
  retryAfter?: number
}

export interface ErrorResponse {
  canRetry: boolean
  retryAfter?: number
  userMessage: string
  logMessage: string
  errorCode: string
  category: ErrorCategory
  severity: ErrorSeverity
  suggestedAction?: string
}

export class IngestionError extends Error {
  constructor(
    message: string,
    public code: string,
    public category: ErrorCategory,
    public severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    public retryable: boolean = false,
    public context?: ErrorContext,
    public cause?: Error
  ) {
    super(message)
    this.name = 'IngestionError'
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
      cause: this.cause?.message
    }
  }
}

export class ValidationError extends IngestionError {
  constructor(message: string, context?: ErrorContext, cause?: Error) {
    super(
      message,
      'VALIDATION_ERROR',
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      false,
      context,
      cause
    )
    this.name = 'ValidationError'
  }
}

export class ScrapingError extends IngestionError {
  constructor(
    message: string,
    retryable = true,
    severity = ErrorSeverity.MEDIUM,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'SCRAPING_ERROR',
      ErrorCategory.SCRAPING,
      severity,
      retryable,
      context,
      cause
    )
    this.name = 'ScrapingError'
  }
}

export class EmbeddingError extends IngestionError {
  constructor(
    message: string,
    retryable = true,
    severity = ErrorSeverity.MEDIUM,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'EMBEDDING_ERROR',
      ErrorCategory.EMBEDDING,
      severity,
      retryable,
      context,
      cause
    )
    this.name = 'EmbeddingError'
  }
}

export class StorageError extends IngestionError {
  constructor(
    message: string,
    retryable = true,
    severity = ErrorSeverity.HIGH,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'STORAGE_ERROR',
      ErrorCategory.STORAGE,
      severity,
      retryable,
      context,
      cause
    )
    this.name = 'StorageError'
  }
}

export class JobError extends IngestionError {
  constructor(
    message: string,
    retryable = true,
    severity = ErrorSeverity.MEDIUM,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'JOB_ERROR',
      ErrorCategory.JOB,
      severity,
      retryable,
      context,
      cause
    )
    this.name = 'JobError'
  }
}

export class NetworkError extends IngestionError {
  constructor(
    message: string,
    retryable = true,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'NETWORK_ERROR',
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      retryable,
      context,
      cause
    )
    this.name = 'NetworkError'
  }
}

export class RateLimitError extends IngestionError {
  constructor(
    message: string,
    retryAfter: number,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'RATE_LIMIT_ERROR',
      ErrorCategory.RATE_LIMIT,
      ErrorSeverity.LOW,
      true,
      context ? { ...context, retryAfter } : {
        timestamp: new Date(),
        component: 'Unknown',
        operation: 'Unknown',
        retryAfter
      },
      cause
    )
    this.name = 'RateLimitError'
  }
}

export class CircuitBreakerError extends IngestionError {
  constructor(
    message: string,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(
      message,
      'CIRCUIT_BREAKER_ERROR',
      ErrorCategory.CIRCUIT_BREAKER,
      ErrorSeverity.HIGH,
      false,
      context,
      cause
    )
    this.name = 'CircuitBreakerError'
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function isRetryableError(error: unknown): boolean {
  if (error instanceof IngestionError) {
    return error.retryable
  }

  // Check for common retryable HTTP errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('rate limit') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504')
  }

  return false
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function categorizeError(error: unknown): ErrorCategory {
  if (error instanceof IngestionError) {
    return error.category
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorCategory.VALIDATION
    }

    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return ErrorCategory.NETWORK
    }

    if (message.includes('rate limit') || message.includes('429')) {
      return ErrorCategory.RATE_LIMIT
    }

    if (message.includes('database') || message.includes('storage') || message.includes('prisma')) {
      return ErrorCategory.STORAGE
    }

    if (message.includes('embedding') || message.includes('bedrock')) {
      return ErrorCategory.EMBEDDING
    }

    if (message.includes('scraping') || message.includes('playwright')) {
      return ErrorCategory.SCRAPING
    }
  }

  return ErrorCategory.JOB // Default category
}

export function getErrorSeverity(error: unknown): ErrorSeverity {
  if (error instanceof IngestionError) {
    return error.severity
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('critical') || message.includes('fatal')) {
      return ErrorSeverity.CRITICAL
    }

    if (message.includes('database') || message.includes('storage')) {
      return ErrorSeverity.HIGH
    }

    if (message.includes('network') || message.includes('timeout')) {
      return ErrorSeverity.MEDIUM
    }
  }

  return ErrorSeverity.LOW
}