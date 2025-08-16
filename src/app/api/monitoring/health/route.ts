import { NextRequest, NextResponse } from 'next/server'
import { metricsCollector } from '@/lib/monitoring/metrics'
import { memoryManager } from '@/lib/monitoring/memory'
import { dbMonitor } from '@/lib/db'
import { vectorStore } from '@/lib/vector/store'
import { EmbeddingService } from '@/lib/embed/service'
import { env, isProduction, deploymentConfig } from '@/lib/config/environment'

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  environment: string
  checks: {
    database: {
      status: 'healthy' | 'unhealthy'
      responseTime?: number
      error?: string
    }
    vectorStore: {
      status: 'healthy' | 'unhealthy'
      responseTime?: number
      error?: string
    }
    memory: {
      status: 'normal' | 'warning' | 'critical'
      usagePercent: number
      recommendation: string
    }
    embedding: {
      status: 'healthy' | 'unhealthy'
      responseTime?: number
      error?: string
    }
  }
  performance: {
    avgProcessingSpeed?: number
    avgApiLatency?: number
    avgDbLatency?: number
    memoryTrend: string
  }
  recommendations: string[]
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  // In production, add basic authentication or API key validation
  if (isProduction) {
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    
    // Check for valid API key in production
    const validApiKey = env.HEALTH_CHECK_API_KEY
    if (validApiKey && apiKey !== validApiKey) {
      return NextResponse.json(
        { error: 'Invalid API key for health check' },
        { status: 401 }
      )
    } else if (!validApiKey && !authHeader && !apiKey) {
      return NextResponse.json(
        { error: 'Authentication required for health check in production' },
        { status: 401 }
      )
    }
  }
  
  const healthCheck: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: deploymentConfig.version,
    environment: deploymentConfig.environment,
    checks: {
      database: { status: 'healthy' },
      vectorStore: { status: 'healthy' },
      memory: { status: 'normal', usagePercent: 0, recommendation: '' },
      embedding: { status: 'healthy' }
    },
    performance: {
      memoryTrend: 'stable'
    },
    recommendations: []
  }

  try {
    // Check database health
    try {
      const dbStart = Date.now()
      const dbStats = dbMonitor.getConnectionStats()
      const dbResponseTime = Date.now() - dbStart
      
      healthCheck.checks.database = {
        status: 'healthy',
        responseTime: dbResponseTime
      }
    } catch (error) {
      healthCheck.checks.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Database check failed'
      }
      healthCheck.status = 'unhealthy'
    }

    // Check vector store health
    try {
      const vectorStart = Date.now()
      const isHealthy = await vectorStore.healthCheck()
      const vectorResponseTime = Date.now() - vectorStart
      
      healthCheck.checks.vectorStore = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime: vectorResponseTime
      }
      
      if (!isHealthy) {
        healthCheck.status = 'degraded'
      }
    } catch (error) {
      healthCheck.checks.vectorStore = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Vector store check failed'
      }
      healthCheck.status = 'unhealthy'
    }

    // Check memory status
    try {
      const memoryStatus = memoryManager.checkMemoryUsage()
      healthCheck.checks.memory = {
        status: memoryStatus.status,
        usagePercent: Math.round(memoryStatus.usagePercent),
        recommendation: memoryStatus.recommendation
      }
      
      if (memoryStatus.status === 'critical') {
        healthCheck.status = 'unhealthy'
      } else if (memoryStatus.status === 'warning' && healthCheck.status === 'healthy') {
        healthCheck.status = 'degraded'
      }
    } catch (error) {
      healthCheck.checks.memory = {
        status: 'critical',
        usagePercent: 0,
        recommendation: 'Memory check failed'
      }
      healthCheck.status = 'unhealthy'
    }

    // Check embedding service (lightweight test)
    try {
      const embeddingStart = Date.now()
      const embeddingService = new EmbeddingService({ batchSize: 1 })
      const config = embeddingService.getConfiguration()
      const embeddingResponseTime = Date.now() - embeddingStart
      
      healthCheck.checks.embedding = {
        status: 'healthy',
        responseTime: embeddingResponseTime
      }
    } catch (error) {
      healthCheck.checks.embedding = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Embedding service check failed'
      }
      healthCheck.status = 'degraded'
    }

    // Gather performance metrics
    const timeWindow = 300000 // 5 minutes
    const processingSpeedSummary = metricsCollector.getMetricsSummary('processing_speed', timeWindow)
    const apiLatencySummary = metricsCollector.getMetricsSummary('api_call_duration', timeWindow)
    const dbLatencySummary = metricsCollector.getMetricsSummary('db_query_duration', timeWindow)

    healthCheck.performance = {
      avgProcessingSpeed: processingSpeedSummary?.average,
      avgApiLatency: apiLatencySummary?.average,
      avgDbLatency: dbLatencySummary?.average,
      memoryTrend: 'stable' // Would need more sophisticated analysis
    }

    // Generate recommendations
    const recommendations: string[] = []
    
    if (healthCheck.checks.memory.status === 'critical') {
      recommendations.push('Critical memory usage detected - consider reducing batch sizes and triggering garbage collection')
    } else if (healthCheck.checks.memory.status === 'warning') {
      recommendations.push('High memory usage - monitor closely and consider optimization')
    }

    if (healthCheck.performance.avgApiLatency && healthCheck.performance.avgApiLatency > 5000) {
      recommendations.push('High API latency detected - check network connectivity and service health')
    }

    if (healthCheck.performance.avgDbLatency && healthCheck.performance.avgDbLatency > 1000) {
      recommendations.push('Slow database queries detected - consider query optimization or connection pooling')
    }

    if (healthCheck.performance.avgProcessingSpeed && healthCheck.performance.avgProcessingSpeed < 1) {
      recommendations.push('Low processing speed - consider optimizing batch sizes or parallel processing')
    }

    if (healthCheck.checks.database.status === 'unhealthy') {
      recommendations.push('Database connectivity issues - check connection configuration and network')
    }

    if (healthCheck.checks.vectorStore.status === 'unhealthy') {
      recommendations.push('Vector store issues - verify database schema and pgvector extension')
    }

    if (recommendations.length === 0) {
      recommendations.push('System is operating within normal parameters')
    }

    healthCheck.recommendations = recommendations

    // Record health check metrics
    const totalResponseTime = Date.now() - startTime
    metricsCollector.recordMetric({
      name: 'health_check_duration',
      value: totalResponseTime,
      unit: 'ms',
      timestamp: new Date(),
      tags: { status: healthCheck.status }
    })

    // Set appropriate HTTP status based on health
    let httpStatus = 200
    if (healthCheck.status === 'degraded') {
      httpStatus = 200 // Still OK, but with warnings
    } else if (healthCheck.status === 'unhealthy') {
      httpStatus = 503 // Service Unavailable
    }

    return NextResponse.json(healthCheck, { status: httpStatus })

  } catch (error) {
    console.error('Health check failed:', error)
    
    const errorResponse: HealthCheckResult = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'unhealthy', error: 'Health check failed' },
        vectorStore: { status: 'unhealthy', error: 'Health check failed' },
        memory: { status: 'critical', usagePercent: 0, recommendation: 'Health check failed' },
        embedding: { status: 'unhealthy', error: 'Health check failed' }
      },
      performance: {
        memoryTrend: 'unknown'
      },
      recommendations: [
        'System health check failed - investigate system status',
        error instanceof Error ? error.message : 'Unknown error occurred'
      ]
    }

    return NextResponse.json(errorResponse, { status: 503 })
  }
}