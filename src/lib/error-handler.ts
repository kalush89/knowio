// Comprehensive error handler with categorized responses and recovery mechanisms

import {
    IngestionError,
    ErrorCategory,
    ErrorSeverity,
    ErrorContext,
    ErrorResponse,
    ValidationError,
    ScrapingError,
    EmbeddingError,
    StorageError,
    JobError,
    NetworkError,
    RateLimitError,
    CircuitBreakerError,
    isRetryableError,
    categorizeError,
    getErrorSeverity,
    getErrorMessage
} from './errors'
import { Logger } from './logger'

export interface RetryConfig {
    maxRetries: number
    baseDelay: number
    maxDelay: number
    backoffMultiplier: number
    jitter: boolean
}

export interface ErrorHandlerConfig {
    retryConfig: RetryConfig
    circuitBreakerConfig: {
        failureThreshold: number
        resetTimeout: number
        monitoringPeriod: number
    }
    enableGracefulDegradation: boolean
    logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export class ErrorHandler {
    private logger: Logger
    private config: ErrorHandlerConfig
    private circuitBreakers: Map<string, CircuitBreakerState> = new Map()

    constructor(config?: Partial<ErrorHandlerConfig>) {
        this.config = {
            retryConfig: {
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 30000,
                backoffMultiplier: 2,
                jitter: true
            },
            circuitBreakerConfig: {
                failureThreshold: 5,
                resetTimeout: 60000,
                monitoringPeriod: 300000
            },
            enableGracefulDegradation: true,
            logLevel: 'info',
            ...config
        }

        this.logger = new Logger('ErrorHandler', this.config.logLevel)
    }

    /**
     * Handle and categorize errors with appropriate responses
     */
    async handleError(error: unknown, context?: ErrorContext): Promise<ErrorResponse> {
        const ingestionError = this.normalizeError(error, context)

        // Log the error with full context
        await this.logError(ingestionError, context)

        // Generate categorized response
        const response = this.generateErrorResponse(ingestionError)

        // Update circuit breaker state if applicable
        if (context?.component) {
            this.updateCircuitBreaker(context.component, false)
        }

        return response
    }

    /**
     * Handle scraping errors with specific recovery strategies
     */
    async handleScrapingError(error: unknown, context?: ErrorContext): Promise<ErrorResponse> {
        const scrapingError = error instanceof ScrapingError
            ? error
            : new ScrapingError(getErrorMessage(error), isRetryableError(error), getErrorSeverity(error), context, error as Error)

        this.logger.warn('Scraping error occurred', {
            error: scrapingError.toJSON(),
            context,
            suggestedAction: 'Check URL accessibility and network connectivity'
        })

        return {
            canRetry: scrapingError.retryable,
            retryAfter: this.calculateRetryDelay(context?.attempt || 0),
            userMessage: this.getUserFriendlyMessage(scrapingError),
            logMessage: scrapingError.message,
            errorCode: scrapingError.code,
            category: scrapingError.category,
            severity: scrapingError.severity,
            suggestedAction: 'Verify the URL is accessible and try again. If the issue persists, the website may be blocking automated access.'
        }
    }

    /**
     * Handle embedding errors with AWS Bedrock specific recovery
     */
    async handleEmbeddingError(error: unknown, context?: ErrorContext): Promise<ErrorResponse> {
        const embeddingError = error instanceof EmbeddingError
            ? error
            : new EmbeddingError(getErrorMessage(error), isRetryableError(error), getErrorSeverity(error), context, error as Error)

        // Check if this is a rate limit error
        if (error instanceof Error && error.message.includes('429')) {
            const rateLimitError = new RateLimitError(
                'AWS Bedrock rate limit exceeded',
                this.extractRetryAfter(error.message),
                context,
                error
            )

            this.logger.warn('Rate limit exceeded for embedding service', {
                error: rateLimitError.toJSON(),
                context
            })

            return {
                canRetry: true,
                retryAfter: this.extractRetryAfter(error.message),
                userMessage: 'Embedding service is temporarily rate limited. Retrying automatically.',
                logMessage: rateLimitError.message,
                errorCode: rateLimitError.code,
                category: rateLimitError.category,
                severity: rateLimitError.severity,
                suggestedAction: 'Wait for rate limit to reset and retry automatically'
            }
        }

        this.logger.error('Embedding generation failed', {
            error: embeddingError.toJSON(),
            context
        })

        return {
            canRetry: embeddingError.retryable,
            retryAfter: this.calculateRetryDelay(context?.attempt || 0),
            userMessage: this.getUserFriendlyMessage(embeddingError),
            logMessage: embeddingError.message,
            errorCode: embeddingError.code,
            category: embeddingError.category,
            severity: embeddingError.severity,
            suggestedAction: 'Check AWS Bedrock service status and credentials'
        }
    }

    /**
     * Handle storage errors with database-specific recovery
     */
    async handleStorageError(error: unknown, context?: ErrorContext): Promise<ErrorResponse> {
        const storageError = error instanceof StorageError
            ? error
            : new StorageError(getErrorMessage(error), isRetryableError(error), ErrorSeverity.HIGH, context, error as Error)

        this.logger.error('Database storage error', {
            error: storageError.toJSON(),
            context,
            suggestedAction: 'Check database connectivity and transaction state'
        })

        return {
            canRetry: storageError.retryable,
            retryAfter: this.calculateRetryDelay(context?.attempt || 0),
            userMessage: 'Database storage failed. The system will retry automatically.',
            logMessage: storageError.message,
            errorCode: storageError.code,
            category: storageError.category,
            severity: storageError.severity,
            suggestedAction: 'Check database connectivity and ensure sufficient storage space'
        }
    }

    /**
     * Execute operation with retry logic and circuit breaker
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        context: ErrorContext,
        customRetryConfig?: Partial<RetryConfig>
    ): Promise<T> {
        const retryConfig = { ...this.config.retryConfig, ...customRetryConfig }
        let lastError: Error | undefined

        // Check circuit breaker
        if (this.isCircuitBreakerOpen(context.component)) {
            throw new CircuitBreakerError(
                `Circuit breaker is open for component: ${context.component}`,
                context
            )
        }

        for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
            try {
                const result = await operation()

                // Success - update circuit breaker
                this.updateCircuitBreaker(context.component, true)

                if (attempt > 0) {
                    this.logger.info('Operation succeeded after retry', {
                        component: context.component,
                        operation: context.operation,
                        attempt,
                        totalAttempts: attempt + 1
                    })
                }

                return result
            } catch (error) {
                lastError = error as Error

                // Update context with attempt number
                const attemptContext = { ...context, attempt: attempt + 1 }

                // Log the attempt
                this.logger.warn('Operation attempt failed', {
                    error: getErrorMessage(error),
                    context: attemptContext,
                    isRetryable: isRetryableError(error),
                    remainingAttempts: retryConfig.maxRetries - attempt
                })

                // Check if we should retry
                if (attempt < retryConfig.maxRetries && isRetryableError(error)) {
                    const delay = this.calculateRetryDelay(attempt, retryConfig)
                    this.logger.debug(`Retrying in ${delay}ms`, { context: attemptContext })
                    await this.delay(delay)
                } else {
                    // Update circuit breaker on final failure
                    this.updateCircuitBreaker(context.component, false)
                    break
                }
            }
        }

        // All retries exhausted
        const finalError = new JobError(
            `Operation failed after ${retryConfig.maxRetries + 1} attempts: ${lastError?.message}`,
            false,
            ErrorSeverity.HIGH,
            { ...context, attempt: retryConfig.maxRetries + 1 },
            lastError
        )

        throw finalError
    }

    /**
     * Implement graceful degradation for non-critical failures
     */
    async handleWithGracefulDegradation<T>(
        primaryOperation: () => Promise<T>,
        fallbackOperation: () => Promise<T>,
        context: ErrorContext
    ): Promise<T> {
        if (!this.config.enableGracefulDegradation) {
            return primaryOperation()
        }

        try {
            return await primaryOperation()
        } catch (error) {
            this.logger.warn('Primary operation failed, attempting graceful degradation', {
                error: getErrorMessage(error),
                context
            })

            try {
                const result = await fallbackOperation()

                this.logger.info('Graceful degradation successful', {
                    context,
                    fallbackUsed: true
                })

                return result
            } catch (fallbackError) {
                this.logger.error('Both primary and fallback operations failed', {
                    primaryError: getErrorMessage(error),
                    fallbackError: getErrorMessage(fallbackError),
                    context
                })

                throw error // Throw original error
            }
        }
    }

    // ============================================================================
    // Private Methods
    // ============================================================================

    private normalizeError(error: unknown, context?: ErrorContext): IngestionError {
        if (error instanceof IngestionError) {
            return error
        }

        const message = getErrorMessage(error)
        const category = categorizeError(error)
        const severity = getErrorSeverity(error)
        const retryable = isRetryableError(error)

        return new IngestionError(
            message,
            `${category}_ERROR`,
            category,
            severity,
            retryable,
            context,
            error as Error
        )
    }

    private async logError(error: IngestionError, context?: ErrorContext): Promise<void> {
        const logData = {
            error: error.toJSON(),
            context,
            timestamp: new Date().toISOString(),
            severity: error.severity,
            category: error.category,
            retryable: error.retryable
        }

        switch (error.severity) {
            case ErrorSeverity.CRITICAL:
                this.logger.error('Critical error occurred', logData)
                break
            case ErrorSeverity.HIGH:
                this.logger.error('High severity error', logData)
                break
            case ErrorSeverity.MEDIUM:
                this.logger.warn('Medium severity error', logData)
                break
            case ErrorSeverity.LOW:
                this.logger.info('Low severity error', logData)
                break
        }
    }

    private generateErrorResponse(error: IngestionError): ErrorResponse {
        return {
            canRetry: error.retryable,
            retryAfter: error.retryable ? this.calculateRetryDelay(error.context?.attempt || 0) : undefined,
            userMessage: this.getUserFriendlyMessage(error),
            logMessage: error.message,
            errorCode: error.code,
            category: error.category,
            severity: error.severity,
            suggestedAction: this.getSuggestedAction(error)
        }
    }

    private getUserFriendlyMessage(error: IngestionError): string {
        switch (error.category) {
            case ErrorCategory.VALIDATION:
                return 'The provided URL or input is invalid. Please check and try again.'
            case ErrorCategory.SCRAPING:
                return 'Unable to access or scrape the webpage. The site may be unavailable or blocking automated access.'
            case ErrorCategory.EMBEDDING:
                return 'Failed to generate embeddings for the content. This may be a temporary service issue.'
            case ErrorCategory.STORAGE:
                return 'Failed to save the processed content to the database. Please try again.'
            case ErrorCategory.NETWORK:
                return 'Network connectivity issue. Please check your connection and try again.'
            case ErrorCategory.RATE_LIMIT:
                return 'Service rate limit exceeded. The system will retry automatically.'
            case ErrorCategory.CIRCUIT_BREAKER:
                return 'Service is temporarily unavailable due to repeated failures. Please try again later.'
            default:
                return 'An unexpected error occurred during processing. Please try again.'
        }
    }

    private getSuggestedAction(error: IngestionError): string {
        switch (error.category) {
            case ErrorCategory.VALIDATION:
                return 'Verify the URL format and ensure it points to accessible content'
            case ErrorCategory.SCRAPING:
                return 'Check if the website is accessible and not blocking automated requests'
            case ErrorCategory.EMBEDDING:
                return 'Verify AWS Bedrock service status and API credentials'
            case ErrorCategory.STORAGE:
                return 'Check database connectivity and available storage space'
            case ErrorCategory.NETWORK:
                return 'Verify network connectivity and firewall settings'
            case ErrorCategory.RATE_LIMIT:
                return 'Wait for rate limit to reset, retries will happen automatically'
            case ErrorCategory.CIRCUIT_BREAKER:
                return 'Wait for service to recover, then try again'
            default:
                return 'Review logs for detailed error information and contact support if needed'
        }
    }

    private calculateRetryDelay(attempt: number, config?: RetryConfig): number {
        const retryConfig = config || this.config.retryConfig

        let delay = retryConfig.baseDelay * Math.pow(retryConfig.backoffMultiplier, attempt)
        delay = Math.min(delay, retryConfig.maxDelay)

        if (retryConfig.jitter) {
            delay = delay * (0.5 + Math.random() * 0.5) // Add 0-50% jitter
        }

        return Math.floor(delay)
    }

    private extractRetryAfter(errorMessage: string): number {
        const match = errorMessage.match(/retry.*?(\d+)/i)
        return match ? parseInt(match[1]) * 1000 : 5000 // Default 5 seconds
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    // ============================================================================
    // Circuit Breaker Implementation
    // ============================================================================

    private isCircuitBreakerOpen(component: string): boolean {
        const state = this.circuitBreakers.get(component)
        if (!state) return false

        const now = Date.now()

        // Reset circuit breaker if timeout has passed
        if (state.state === 'open' && now - state.lastFailureTime > this.config.circuitBreakerConfig.resetTimeout) {
            state.state = 'half-open'
            state.consecutiveFailures = 0
            this.logger.info('Circuit breaker transitioning to half-open', { component })
        }

        return state.state === 'open'
    }

    private updateCircuitBreaker(component: string, success: boolean): void {
        let state = this.circuitBreakers.get(component)

        if (!state) {
            state = {
                state: 'closed',
                consecutiveFailures: 0,
                lastFailureTime: 0,
                totalFailures: 0,
                totalRequests: 0
            }
            this.circuitBreakers.set(component, state)
        }

        state.totalRequests++

        if (success) {
            if (state.state === 'half-open') {
                state.state = 'closed'
                this.logger.info('Circuit breaker closed after successful operation', { component })
            }
            state.consecutiveFailures = 0
        } else {
            state.consecutiveFailures++
            state.totalFailures++
            state.lastFailureTime = Date.now()

            if (state.consecutiveFailures >= this.config.circuitBreakerConfig.failureThreshold) {
                state.state = 'open'
                this.logger.warn('Circuit breaker opened due to consecutive failures', {
                    component,
                    consecutiveFailures: state.consecutiveFailures,
                    threshold: this.config.circuitBreakerConfig.failureThreshold
                })
            }
        }
    }
}

// ============================================================================
// Circuit Breaker State Interface
// ============================================================================

interface CircuitBreakerState {
    state: 'closed' | 'open' | 'half-open'
    consecutiveFailures: number
    lastFailureTime: number
    totalFailures: number
    totalRequests: number
}

// ============================================================================
// Default Error Handler Instance
// ============================================================================

export const defaultErrorHandler = new ErrorHandler()