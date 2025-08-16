// Structured logging system for the ingestion pipeline

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export interface LogEntry {
  timestamp: string
  level: string
  component: string
  message: string
  data?: Record<string, any>
  error?: {
    name: string
    message: string
    stack?: string
    code?: string
    category?: string
    severity?: string
  }
  context?: {
    jobId?: string
    url?: string
    chunkId?: string
    batchNumber?: number
    attempt?: number
    operation?: string
    metadata?: Record<string, any>
  }
  performance?: {
    duration?: number
    memoryUsage?: NodeJS.MemoryUsage
    timestamp: number
  }
  traceId?: string
}

export interface LoggerConfig {
  level: LogLevel
  enableConsole: boolean
  enableFile: boolean
  enableStructured: boolean
  component: string
  includeStackTrace: boolean
  includePerformanceMetrics: boolean
}

export class Logger {
  private config: LoggerConfig
  private startTimes: Map<string, number> = new Map()

  constructor(component: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info', config?: Partial<LoggerConfig>) {
    this.config = {
      level: this.parseLogLevel(level),
      enableConsole: true,
      enableFile: false,
      enableStructured: true,
      component,
      includeStackTrace: true,
      includePerformanceMetrics: true,
      ...config
    }
  }

  /**
   * Log debug information
   */
  debug(message: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    this.log(LogLevel.DEBUG, message, data, context)
  }

  /**
   * Log informational messages
   */
  info(message: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    this.log(LogLevel.INFO, message, data, context)
  }

  /**
   * Log warning messages
   */
  warn(message: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    this.log(LogLevel.WARN, message, data, context)
  }

  /**
   * Log error messages
   */
  error(message: string, data?: Record<string, any>, context?: LogEntry['context'], error?: Error): void {
    const errorData = error ? this.serializeError(error) : undefined
    this.log(LogLevel.ERROR, message, { ...data, error: errorData }, context)
  }

  /**
   * Start performance timing
   */
  startTimer(operation: string): void {
    this.startTimes.set(operation, Date.now())
  }

  /**
   * End performance timing and log
   */
  endTimer(operation: string, message?: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    const startTime = this.startTimes.get(operation)
    if (startTime) {
      const duration = Date.now() - startTime
      this.startTimes.delete(operation)
      
      const performanceData = {
        ...data,
        performance: {
          operation,
          duration,
          memoryUsage: this.config.includePerformanceMetrics ? process.memoryUsage() : undefined,
          timestamp: Date.now()
        }
      }
      
      this.info(message || `Operation ${operation} completed`, performanceData, context)
    }
  }

  /**
   * Log with performance metrics
   */
  withPerformance<T>(operation: string, fn: () => Promise<T>, context?: LogEntry['context']): Promise<T> {
    return this.measureAsync(operation, fn, context)
  }

  /**
   * Measure async operation performance
   */
  async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LogEntry['context']
  ): Promise<T> {
    const startTime = Date.now()
    const startMemory = this.config.includePerformanceMetrics ? process.memoryUsage() : undefined
    
    try {
      this.debug(`Starting operation: ${operation}`, undefined, context)
      
      const result = await fn()
      
      const duration = Date.now() - startTime
      const endMemory = this.config.includePerformanceMetrics ? process.memoryUsage() : undefined
      
      this.info(`Operation completed: ${operation}`, {
        performance: {
          operation,
          duration,
          startMemory,
          endMemory,
          memoryDelta: endMemory && startMemory ? {
            rss: endMemory.rss - startMemory.rss,
            heapUsed: endMemory.heapUsed - startMemory.heapUsed,
            heapTotal: endMemory.heapTotal - startMemory.heapTotal
          } : undefined,
          timestamp: Date.now()
        }
      }, context)
      
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      
      this.error(`Operation failed: ${operation}`, {
        performance: {
          operation,
          duration,
          failed: true,
          timestamp: Date.now()
        }
      }, context, error as Error)
      
      throw error
    }
  }

  /**
   * Create child logger with additional context
   */
  child(additionalContext: Record<string, any>): Logger {
    const childLogger = new Logger(this.config.component, this.getLevelName(this.config.level).toLowerCase() as 'debug' | 'info' | 'warn' | 'error')
    
    // Override public methods to include additional context
    const originalDebug = childLogger.debug.bind(childLogger)
    const originalInfo = childLogger.info.bind(childLogger)
    const originalWarn = childLogger.warn.bind(childLogger)
    const originalError = childLogger.error.bind(childLogger)
    
    childLogger.debug = (message: string, data?: Record<string, any>, context?: LogEntry['context']) => {
      const mergedContext = { ...context, ...additionalContext }
      originalDebug(message, data, mergedContext)
    }
    
    childLogger.info = (message: string, data?: Record<string, any>, context?: LogEntry['context']) => {
      const mergedContext = { ...context, ...additionalContext }
      originalInfo(message, data, mergedContext)
    }
    
    childLogger.warn = (message: string, data?: Record<string, any>, context?: LogEntry['context']) => {
      const mergedContext = { ...context, ...additionalContext }
      originalWarn(message, data, mergedContext)
    }
    
    childLogger.error = (message: string, data?: Record<string, any>, context?: LogEntry['context'], error?: Error) => {
      const mergedContext = { ...context, ...additionalContext }
      originalError(message, data, mergedContext, error)
    }
    
    return childLogger
  }

  /**
   * Log structured entry
   */
  private log(level: LogLevel, message: string, data?: Record<string, any>, context?: LogEntry['context']): void {
    if (level < this.config.level) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: this.getLevelName(level),
      component: this.config.component,
      message,
      data,
      context,
      traceId: this.generateTraceId()
    }

    if (this.config.enableConsole) {
      this.logToConsole(entry)
    }

    if (this.config.enableStructured) {
      this.logStructured(entry)
    }
  }

  /**
   * Log to console with appropriate formatting
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString()
    const prefix = `[${timestamp}] [${entry.level}] [${entry.component}]`
    
    const contextStr = entry.context ? ` (${this.formatContext(entry.context)})` : ''
    const message = `${prefix} ${entry.message}${contextStr}`

    switch (entry.level) {
      case 'DEBUG':
        console.debug(message, entry.data || '')
        break
      case 'INFO':
        console.info(message, entry.data || '')
        break
      case 'WARN':
        console.warn(message, entry.data || '')
        break
      case 'ERROR':
        console.error(message, entry.data || '')
        if (entry.data?.error && this.config.includeStackTrace) {
          console.error('Stack trace:', entry.data.error.stack)
        }
        break
    }
  }

  /**
   * Log structured JSON (for external log aggregation)
   */
  private logStructured(entry: LogEntry): void {
    // In a production environment, this would send to a log aggregation service
    // For now, we'll just output structured JSON to stdout
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_STRUCTURED_LOGS === 'true') {
      console.log(JSON.stringify(entry))
    }
  }

  /**
   * Serialize error objects for logging
   */
  private serializeError(error: Error): LogEntry['error'] {
    return {
      name: error.name,
      message: error.message,
      stack: this.config.includeStackTrace ? error.stack : undefined,
      code: (error as any).code,
      category: (error as any).category,
      severity: (error as any).severity
    }
  }

  /**
   * Format context for console output
   */
  private formatContext(context: LogEntry['context']): string {
    const parts: string[] = []
    
    if (context?.jobId) parts.push(`job:${context.jobId}`)
    if (context?.url) parts.push(`url:${context.url}`)
    if (context?.operation) parts.push(`op:${context.operation}`)
    if (context?.attempt) parts.push(`attempt:${context.attempt}`)
    if (context?.batchNumber) parts.push(`batch:${context.batchNumber}`)
    
    return parts.join(', ')
  }

  /**
   * Parse log level from string
   */
  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'debug': return LogLevel.DEBUG
      case 'info': return LogLevel.INFO
      case 'warn': return LogLevel.WARN
      case 'error': return LogLevel.ERROR
      default: return LogLevel.INFO
    }
  }

  /**
   * Get log level name
   */
  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return 'DEBUG'
      case LogLevel.INFO: return 'INFO'
      case LogLevel.WARN: return 'WARN'
      case LogLevel.ERROR: return 'ERROR'
      default: return 'INFO'
    }
  }

  /**
   * Generate trace ID for request correlation
   */
  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
}

// ============================================================================
// Component-specific loggers
// ============================================================================

export const createLogger = (component: string, level?: 'debug' | 'info' | 'warn' | 'error'): Logger => {
  const logLevel = level || (process.env.LOG_LEVEL as any) || 'info'
  const isProduction = process.env.NODE_ENV === 'production'
  
  return new Logger(component, logLevel, {
    enableFile: isProduction,
    enableStructured: isProduction,
    includeStackTrace: true,
    includePerformanceMetrics: true
  })
}

// Pre-configured loggers for common components
export const loggers = {
  scraper: createLogger('WebScraper'),
  chunker: createLogger('ContentChunker'),
  embedder: createLogger('EmbeddingService'),
  storage: createLogger('VectorStore'),
  vectorStore: createLogger('VectorStore'),
  jobQueue: createLogger('JobQueue'),
  processor: createLogger('JobProcessor'),
  api: createLogger('API'),
  validator: createLogger('URLValidator'),
  errorHandler: createLogger('ErrorHandler'),
  database: createLogger('Database'),
  metrics: createLogger('Metrics'),
  performance: createLogger('Performance'),
  memory: createLogger('Memory'),
  auth: createLogger('Authentication')
}

// ============================================================================
// Logging Middleware and Utilities
// ============================================================================

/**
 * Express-style logging middleware
 */
export function createLoggingMiddleware(logger: Logger) {
  return (req: any, res: any, next: any) => {
    const startTime = Date.now()
    const traceId = req.headers['x-trace-id'] || logger['generateTraceId']()
    
    // Add trace ID to request
    req.traceId = traceId
    
    logger.info('Request started', {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      traceId
    })
    
    // Override res.end to log response
    const originalEnd = res.end
    res.end = function(...args: any[]) {
      const duration = Date.now() - startTime
      
      logger.info('Request completed', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        traceId
      })
      
      originalEnd.apply(res, args)
    }
    
    next()
  }
}

/**
 * Log function execution with automatic error handling
 */
export function logExecution<T extends any[], R>(
  logger: Logger,
  operation: string,
  fn: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    return logger.measureAsync(operation, () => fn(...args))
  }
}