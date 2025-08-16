// Monitoring and Performance Optimization Module
// This module provides comprehensive monitoring, metrics collection, and performance optimization
// for the document ingestion system.

export { metricsCollector, MetricsCollector } from './metrics'
export type { MetricData, ProcessingMetrics, SystemMetrics } from './metrics'

export { performanceMonitor, PerformanceMonitor } from './performance'
export type { PerformanceProfile, ResourceUsage } from './performance'

export { memoryManager, MemoryManager } from './memory'
export type { MemoryThresholds, MemoryOptimizationOptions } from './memory'

// Re-export commonly used monitoring functions
export const monitoring = {
  // Metrics collection
  recordMetric: (metric: import('./metrics').MetricData) => metricsCollector.recordMetric(metric),
  recordProcessingSpeed: (chunks: number, duration: number) => metricsCollector.recordProcessingSpeed(chunks, duration),
  recordApiCall: (service: string, operation: string, duration: number, success: boolean) => 
    metricsCollector.recordApiCall(service, operation, duration, success),
  
  // Performance monitoring
  startProfiling: (operationId: string, metadata?: Record<string, any>) => 
    performanceMonitor.startProfiling(operationId, metadata),
  endProfiling: (operationId: string) => performanceMonitor.endProfiling(operationId),
  
  // Memory management
  checkMemoryUsage: () => memoryManager.checkMemoryUsage(),
  optimizeForLargeDocuments: <T>(operation: string, fn: (params: any) => Promise<T>) =>
    memoryManager.optimizeForLargeDocuments(operation, fn),
  
  // System health
  getSystemHealth: () => ({
    metrics: metricsCollector.getSystemMetrics('system', 'health_check'),
    performance: performanceMonitor.getPerformanceReport(),
    memory: memoryManager.checkMemoryUsage(),
    recommendations: memoryManager.getOptimizationRecommendations()
  })
}

// Monitoring configuration
export const monitoringConfig = {
  // Default thresholds
  memoryThresholds: {
    warning: 512 * 1024 * 1024, // 512MB
    critical: 1024 * 1024 * 1024, // 1GB
    maxHeapSize: 2048 * 1024 * 1024 // 2GB
  },
  
  // Performance targets
  performanceTargets: {
    maxApiLatency: 5000, // 5 seconds
    maxDbLatency: 1000, // 1 second
    minProcessingSpeed: 1, // 1 chunk per second
    maxMemoryUsagePercent: 80
  },
  
  // Monitoring intervals
  intervals: {
    memoryCheck: 10000, // 10 seconds
    metricsCleanup: 600000, // 10 minutes
    performanceReport: 300000 // 5 minutes
  }
}

// Utility functions for common monitoring patterns
export const monitoringUtils = {
  /**
   * Wrap a function with comprehensive monitoring
   */
  withMonitoring: <T extends any[], R>(
    operationName: string,
    fn: (...args: T) => Promise<R>
  ) => {
    return async (...args: T): Promise<R> => {
      const operationId = `${operationName}_${Date.now()}`
      
      performanceMonitor.startProfiling(operationId, { args: args.length })
      metricsCollector.recordMemoryUsage(operationName)
      
      try {
        const result = await fn(...args)
        performanceMonitor.endProfiling(operationId, { success: true })
        return result
      } catch (error) {
        performanceMonitor.endProfiling(operationId, { success: false, error: error instanceof Error ? error.message : 'Unknown error' })
        throw error
      }
    }
  },

  /**
   * Monitor batch processing operations
   */
  monitorBatchProcessing: async <T, R>(
    operationName: string,
    items: T[],
    processor: (item: T) => Promise<R>,
    options?: {
      batchSize?: number
      memoryOptimized?: boolean
    }
  ): Promise<R[]> => {
    const { batchSize = 50, memoryOptimized = true } = options || {}
    
    if (memoryOptimized) {
      return memoryManager.processChunksWithMemoryManagement(
        items,
        processor,
        { initialBatchSize: batchSize }
      )
    } else {
      const results: R[] = []
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize)
        const batchResults = await Promise.all(batch.map(processor))
        results.push(...batchResults)
        
        // Record progress
        metricsCollector.recordProcessingSpeed(
          batch.length,
          Date.now() - Date.now(), // This would be actual duration in real usage
          { operation: operationName, batch: Math.floor(i / batchSize) + 1 }
        )
      }
      return results
    }
  },

  /**
   * Create a monitoring middleware for API routes
   */
  createApiMonitoring: (routeName: string) => {
    return {
      start: () => {
        const operationId = `api_${routeName}_${Date.now()}`
        performanceMonitor.startProfiling(operationId, { route: routeName })
        metricsCollector.recordMemoryUsage(`api_${routeName}`)
        return operationId
      },
      
      end: (operationId: string, success: boolean, statusCode?: number) => {
        performanceMonitor.endProfiling(operationId, { success, statusCode })
        metricsCollector.recordApiCall('api', routeName, 0, success, { status_code: statusCode?.toString() })
      }
    }
  }
}