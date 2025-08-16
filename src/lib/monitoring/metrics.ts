import { performance } from 'perf_hooks'
import { loggers } from '../logger'

export interface MetricData {
  name: string
  value: number
  unit: 'ms' | 'bytes' | 'count' | 'percentage' | 'rate'
  timestamp: Date
  tags?: Record<string, string | number>
  metadata?: Record<string, any>
}

export interface ProcessingMetrics {
  // Performance metrics
  processingSpeed: number // chunks per second
  averageChunkSize: number // bytes
  memoryUsage: number // bytes
  cpuUsage?: number // percentage
  
  // API usage metrics
  embeddingApiCalls: number
  embeddingApiLatency: number // ms
  embeddingApiErrors: number
  
  // Database metrics
  dbConnectionCount: number
  dbQueryLatency: number // ms
  dbQueryCount: number
  
  // Resource metrics
  totalMemoryUsed: number // bytes
  peakMemoryUsed: number // bytes
  gcCollections?: number
}

export interface SystemMetrics {
  timestamp: Date
  component: string
  operation: string
  metrics: ProcessingMetrics
  metadata?: Record<string, any>
}

export class MetricsCollector {
  private readonly logger = loggers.metrics
  private readonly metrics: Map<string, MetricData[]> = new Map()
  private readonly startTimes: Map<string, number> = new Map()
  private readonly memoryBaseline: number
  
  constructor() {
    this.memoryBaseline = process.memoryUsage().heapUsed
    this.setupPeriodicCollection()
  }

  /**
   * Start timing an operation
   */
  startTimer(operationId: string, metadata?: Record<string, any>): void {
    this.startTimes.set(operationId, performance.now())
    
    if (metadata) {
      this.logger.debug('Started timing operation', {
        operationId,
        ...metadata
      })
    }
  }

  /**
   * End timing an operation and record the duration
   */
  endTimer(operationId: string, tags?: Record<string, string | number>): number {
    const startTime = this.startTimes.get(operationId)
    if (!startTime) {
      this.logger.warn('No start time found for operation', { operationId })
      return 0
    }

    const duration = performance.now() - startTime
    this.startTimes.delete(operationId)

    this.recordMetric({
      name: 'operation_duration',
      value: duration,
      unit: 'ms',
      timestamp: new Date(),
      tags: { operation: operationId, ...tags }
    })

    return duration
  }

  /**
   * Record a custom metric
   */
  recordMetric(metric: MetricData): void {
    const key = metric.name
    if (!this.metrics.has(key)) {
      this.metrics.set(key, [])
    }
    
    const metricsList = this.metrics.get(key)!
    metricsList.push(metric)
    
    // Keep only last 1000 metrics per type to prevent memory leaks
    if (metricsList.length > 1000) {
      metricsList.shift()
    }

    this.logger.debug('Recorded metric', {
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
      tags: metric.tags
    })
  }

  /**
   * Record processing speed metrics
   */
  recordProcessingSpeed(chunksProcessed: number, durationMs: number, tags?: Record<string, string | number>): void {
    const rate = chunksProcessed / (durationMs / 1000) // chunks per second
    
    this.recordMetric({
      name: 'processing_speed',
      value: rate,
      unit: 'rate',
      timestamp: new Date(),
      tags: { ...tags, chunks_processed: chunksProcessed },
      metadata: { duration_ms: durationMs }
    })
  }

  /**
   * Record memory usage metrics
   */
  recordMemoryUsage(operation: string, tags?: Record<string, string | number>): void {
    const memUsage = process.memoryUsage()
    
    this.recordMetric({
      name: 'memory_heap_used',
      value: memUsage.heapUsed,
      unit: 'bytes',
      timestamp: new Date(),
      tags: { operation, ...tags }
    })

    this.recordMetric({
      name: 'memory_heap_total',
      value: memUsage.heapTotal,
      unit: 'bytes',
      timestamp: new Date(),
      tags: { operation, ...tags }
    })

    this.recordMetric({
      name: 'memory_external',
      value: memUsage.external,
      unit: 'bytes',
      timestamp: new Date(),
      tags: { operation, ...tags }
    })
  }

  /**
   * Record API usage metrics
   */
  recordApiCall(
    service: string, 
    operation: string, 
    durationMs: number, 
    success: boolean,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name: 'api_call_duration',
      value: durationMs,
      unit: 'ms',
      timestamp: new Date(),
      tags: { service, operation, success: success.toString(), ...tags }
    })

    this.recordMetric({
      name: 'api_call_count',
      value: 1,
      unit: 'count',
      timestamp: new Date(),
      tags: { service, operation, success: success.toString(), ...tags }
    })
  }

  /**
   * Record database metrics
   */
  recordDatabaseMetrics(
    operation: string,
    durationMs: number,
    rowsAffected?: number,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name: 'db_query_duration',
      value: durationMs,
      unit: 'ms',
      timestamp: new Date(),
      tags: { operation, ...tags }
    })

    if (rowsAffected !== undefined) {
      this.recordMetric({
        name: 'db_rows_affected',
        value: rowsAffected,
        unit: 'count',
        timestamp: new Date(),
        tags: { operation, ...tags }
      })
    }
  }

  /**
   * Get metrics summary for a specific metric name
   */
  getMetricsSummary(metricName: string, timeWindowMs?: number): {
    count: number
    average: number
    min: number
    max: number
    latest: number
    p95: number
  } | null {
    const metricsList = this.metrics.get(metricName)
    if (!metricsList || metricsList.length === 0) {
      return null
    }

    let filteredMetrics = metricsList
    if (timeWindowMs) {
      const cutoff = new Date(Date.now() - timeWindowMs)
      filteredMetrics = metricsList.filter(m => m.timestamp >= cutoff)
    }

    if (filteredMetrics.length === 0) {
      return null
    }

    const values = filteredMetrics.map(m => m.value).sort((a, b) => a - b)
    const sum = values.reduce((acc, val) => acc + val, 0)
    const p95Index = Math.floor(values.length * 0.95)

    return {
      count: values.length,
      average: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      latest: filteredMetrics[filteredMetrics.length - 1].value,
      p95: values[p95Index] || values[values.length - 1]
    }
  }

  /**
   * Get comprehensive system metrics
   */
  getSystemMetrics(component: string, operation: string): SystemMetrics {
    const memUsage = process.memoryUsage()
    
    // Calculate processing metrics from recent data
    const processingSpeedSummary = this.getMetricsSummary('processing_speed', 60000) // last minute
    const apiLatencySummary = this.getMetricsSummary('api_call_duration', 60000)
    const dbLatencySummary = this.getMetricsSummary('db_query_duration', 60000)
    
    const apiCallsCount = this.getMetricsSummary('api_call_count', 60000)?.count || 0
    const apiErrorsCount = this.metrics.get('api_call_count')
      ?.filter(m => 
        m.tags?.success === 'false' && 
        m.timestamp >= new Date(Date.now() - 60000)
      ).length || 0

    return {
      timestamp: new Date(),
      component,
      operation,
      metrics: {
        processingSpeed: processingSpeedSummary?.average || 0,
        averageChunkSize: this.getMetricsSummary('chunk_size', 60000)?.average || 0,
        memoryUsage: memUsage.heapUsed,
        
        embeddingApiCalls: apiCallsCount,
        embeddingApiLatency: apiLatencySummary?.average || 0,
        embeddingApiErrors: apiErrorsCount,
        
        dbConnectionCount: this.getCurrentDbConnections(),
        dbQueryLatency: dbLatencySummary?.average || 0,
        dbQueryCount: this.getMetricsSummary('db_query_duration', 60000)?.count || 0,
        
        totalMemoryUsed: memUsage.heapUsed,
        peakMemoryUsed: memUsage.heapTotal
      }
    }
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(format: 'json' | 'prometheus' = 'json'): string {
    if (format === 'prometheus') {
      return this.exportPrometheusFormat()
    }

    const exportData = {
      timestamp: new Date().toISOString(),
      metrics: Object.fromEntries(
        Array.from(this.metrics.entries()).map(([name, data]) => [
          name,
          {
            count: data.length,
            latest: data[data.length - 1],
            summary: this.getMetricsSummary(name)
          }
        ])
      )
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * Clear old metrics to prevent memory leaks
   */
  clearOldMetrics(olderThanMs: number = 3600000): void { // default 1 hour
    const cutoff = new Date(Date.now() - olderThanMs)
    
    for (const [name, metricsList] of this.metrics.entries()) {
      const filtered = metricsList.filter(m => m.timestamp >= cutoff)
      this.metrics.set(name, filtered)
    }

    this.logger.debug('Cleared old metrics', {
      cutoffTime: cutoff.toISOString(),
      remainingMetricTypes: this.metrics.size
    })
  }

  /**
   * Setup periodic collection of system metrics
   */
  private setupPeriodicCollection(): void {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      this.recordMemoryUsage('periodic_collection')
      
      // Record GC stats if available
      if (global.gc) {
        const gcBefore = process.memoryUsage()
        global.gc()
        const gcAfter = process.memoryUsage()
        
        this.recordMetric({
          name: 'gc_memory_freed',
          value: gcBefore.heapUsed - gcAfter.heapUsed,
          unit: 'bytes',
          timestamp: new Date()
        })
      }
    }, 30000)

    // Clear old metrics every 10 minutes
    setInterval(() => {
      this.clearOldMetrics()
    }, 600000)
  }

  /**
   * Get current database connection count (placeholder - would need actual DB pool integration)
   */
  private getCurrentDbConnections(): number {
    // This would integrate with actual connection pool
    // For now, return a placeholder value
    return 1
  }

  /**
   * Export metrics in Prometheus format
   */
  private exportPrometheusFormat(): string {
    const lines: string[] = []
    
    for (const [name, metricsList] of this.metrics.entries()) {
      if (metricsList.length === 0) continue
      
      const latest = metricsList[metricsList.length - 1]
      const metricName = name.replace(/[^a-zA-Z0-9_]/g, '_')
      
      // Add help and type comments
      lines.push(`# HELP ${metricName} ${name} metric`)
      lines.push(`# TYPE ${metricName} gauge`)
      
      // Add metric with labels
      const labels = latest.tags 
        ? Object.entries(latest.tags)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',')
        : ''
      
      lines.push(`${metricName}{${labels}} ${latest.value}`)
    }
    
    return lines.join('\n')
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector()