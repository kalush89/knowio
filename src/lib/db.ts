import { PrismaClient } from '@prisma/client'
import { metricsCollector } from './monitoring/metrics'
import { loggers } from './logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Enhanced Prisma configuration with connection pooling and monitoring
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'info',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

// Setup query monitoring and metrics collection
prisma.$on('query', (e) => {
  const duration = e.duration
  const query = e.query
  
  // Record database metrics
  metricsCollector.recordDatabaseMetrics(
    'query',
    duration,
    undefined,
    {
      query_type: query.split(' ')[0]?.toLowerCase() || 'unknown'
    }
  )

  // Log slow queries
  if (duration > 1000) { // queries taking more than 1 second
    loggers.database.warn('Slow query detected', {
      duration,
      query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
      params: e.params
    })
  }
})

prisma.$on('error', (e) => {
  loggers.database.error('Database error', {
    target: e.target,
    message: e.message
  })
})

prisma.$on('info', (e) => {
  loggers.database.info('Database info', {
    target: e.target,
    message: e.message
  })
})

prisma.$on('warn', (e) => {
  loggers.database.warn('Database warning', {
    target: e.target,
    message: e.message
  })
})

// Connection pool monitoring
export class DatabaseMonitor {
  private static instance: DatabaseMonitor
  private connectionCount = 0
  private queryCount = 0
  private readonly logger = loggers.database

  static getInstance(): DatabaseMonitor {
    if (!DatabaseMonitor.instance) {
      DatabaseMonitor.instance = new DatabaseMonitor()
    }
    return DatabaseMonitor.instance
  }

  /**
   * Execute a query with monitoring and metrics collection
   */
  async executeWithMonitoring<T>(
    operation: string,
    queryFn: () => Promise<T>
  ): Promise<T> {
    const operationId = `db_${operation}_${Date.now()}`
    metricsCollector.startTimer(operationId, { operation })
    
    this.connectionCount++
    this.queryCount++
    
    try {
      const result = await queryFn()
      const duration = metricsCollector.endTimer(operationId, { 
        operation, 
        success: 'true' 
      })
      
      this.logger.debug('Database operation completed', {
        operation,
        duration,
        connectionCount: this.connectionCount,
        totalQueries: this.queryCount
      })
      
      return result
    } catch (error) {
      metricsCollector.endTimer(operationId, { 
        operation, 
        success: 'false' 
      })
      
      this.logger.error('Database operation failed', {
        operation,
        connectionCount: this.connectionCount,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      throw error
    } finally {
      this.connectionCount--
    }
  }

  /**
   * Get current connection statistics
   */
  getConnectionStats() {
    return {
      activeConnections: this.connectionCount,
      totalQueries: this.queryCount,
      timestamp: new Date()
    }
  }

  /**
   * Optimize database connections and cleanup
   */
  async optimizeConnections(): Promise<void> {
    try {
      // Force connection cleanup
      await prisma.$disconnect()
      await prisma.$connect()
      
      this.logger.info('Database connections optimized', {
        previousConnections: this.connectionCount,
        totalQueries: this.queryCount
      })
      
      // Reset counters after optimization
      this.connectionCount = 0
    } catch (error) {
      this.logger.error('Failed to optimize database connections', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }
}

export const dbMonitor = DatabaseMonitor.getInstance()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Graceful shutdown handling
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})