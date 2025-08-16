import { performance } from 'perf_hooks'
import { metricsCollector } from './metrics'
import { loggers } from '../logger'

export interface PerformanceProfile {
  operation: string
  startTime: number
  endTime?: number
  duration?: number
  memoryBefore: NodeJS.MemoryUsage
  memoryAfter?: NodeJS.MemoryUsage
  memoryDelta?: number
  metadata?: Record<string, any>
}

export interface ResourceUsage {
  cpuUsage?: NodeJS.CpuUsage
  memoryUsage: NodeJS.MemoryUsage
  timestamp: Date
  operation: string
}

export class PerformanceMonitor {
  private readonly profiles: Map<string, PerformanceProfile> = new Map()
  private readonly logger = loggers.performance
  private readonly resourceHistory: ResourceUsage[] = []
  private readonly maxHistorySize = 1000

  /**
   * Start profiling an operation
   */
  startProfiling(operationId: string, metadata?: Record<string, any>): void {
    const profile: PerformanceProfile = {
      operation: operationId,
      startTime: performance.now(),
      memoryBefore: process.memoryUsage(),
      metadata
    }

    this.profiles.set(operationId, profile)
    metricsCollector.startTimer(`perf_${operationId}`, metadata)

    this.logger.debug('Started profiling operation', {
      operationId,
      memoryBefore: profile.memoryBefore.heapUsed,
      ...metadata
    })
  }

  /**
   * End profiling an operation and collect metrics
   */
  endProfiling(operationId: string, additionalMetadata?: Record<string, any>): PerformanceProfile | null {
    const profile = this.profiles.get(operationId)
    if (!profile) {
      this.logger.warn('No profiling data found for operation', { operationId })
      return null
    }

    profile.endTime = performance.now()
    profile.duration = profile.endTime - profile.startTime
    profile.memoryAfter = process.memoryUsage()
    profile.memoryDelta = profile.memoryAfter.heapUsed - profile.memoryBefore.heapUsed

    // Record metrics
    metricsCollector.endTimer(`perf_${operationId}`)
    metricsCollector.recordMetric({
      name: 'memory_delta',
      value: profile.memoryDelta,
      unit: 'bytes',
      timestamp: new Date(),
      tags: { operation: operationId }
    })

    // Log performance data
    this.logger.info('Operation profiling completed', {
      operationId,
      duration: Math.round(profile.duration),
      memoryDelta: profile.memoryDelta,
      memoryBefore: profile.memoryBefore.heapUsed,
      memoryAfter: profile.memoryAfter.heapUsed,
      ...profile.metadata,
      ...additionalMetadata
    })

    this.profiles.delete(operationId)
    return profile
  }

  /**
   * Monitor resource usage for a specific operation
   */
  async monitorResourceUsage<T>(
    operation: string,
    fn: () => Promise<T>,
    options?: {
      sampleInterval?: number
      trackCpu?: boolean
    }
  ): Promise<T> {
    const sampleInterval = options?.sampleInterval || 1000 // 1 second
    const trackCpu = options?.trackCpu || false
    
    let cpuBefore: NodeJS.CpuUsage | undefined
    if (trackCpu) {
      cpuBefore = process.cpuUsage()
    }

    const operationId = `resource_${operation}_${Date.now()}`
    this.startProfiling(operationId, { trackCpu })

    // Start resource sampling
    const samplingInterval = setInterval(() => {
      this.recordResourceUsage(operation)
    }, sampleInterval)

    try {
      const result = await fn()
      
      // Calculate CPU usage if tracking
      let cpuDelta: NodeJS.CpuUsage | undefined
      if (trackCpu && cpuBefore) {
        cpuDelta = process.cpuUsage(cpuBefore)
        
        metricsCollector.recordMetric({
          name: 'cpu_usage_user',
          value: cpuDelta.user / 1000, // convert to milliseconds
          unit: 'ms',
          timestamp: new Date(),
          tags: { operation }
        })

        metricsCollector.recordMetric({
          name: 'cpu_usage_system',
          value: cpuDelta.system / 1000,
          unit: 'ms',
          timestamp: new Date(),
          tags: { operation }
        })
      }

      const profile = this.endProfiling(operationId, { cpuDelta })
      
      return result
    } finally {
      clearInterval(samplingInterval)
    }
  }

  /**
   * Record current resource usage
   */
  recordResourceUsage(operation: string): void {
    const usage: ResourceUsage = {
      memoryUsage: process.memoryUsage(),
      timestamp: new Date(),
      operation
    }

    this.resourceHistory.push(usage)
    
    // Keep history size manageable
    if (this.resourceHistory.length > this.maxHistorySize) {
      this.resourceHistory.shift()
    }

    // Record metrics
    metricsCollector.recordMemoryUsage(operation)
  }

  /**
   * Get resource usage statistics for an operation
   */
  getResourceStats(operation: string, timeWindowMs?: number): {
    samples: number
    avgMemoryUsage: number
    peakMemoryUsage: number
    memoryTrend: 'increasing' | 'decreasing' | 'stable'
  } | null {
    let samples = this.resourceHistory.filter(r => r.operation === operation)
    
    if (timeWindowMs) {
      const cutoff = new Date(Date.now() - timeWindowMs)
      samples = samples.filter(r => r.timestamp >= cutoff)
    }

    if (samples.length === 0) {
      return null
    }

    const memoryValues = samples.map(s => s.memoryUsage.heapUsed)
    const avgMemory = memoryValues.reduce((sum, val) => sum + val, 0) / memoryValues.length
    const peakMemory = Math.max(...memoryValues)

    // Calculate trend (simple linear regression slope)
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable'
    if (samples.length > 1) {
      const firstHalf = memoryValues.slice(0, Math.floor(memoryValues.length / 2))
      const secondHalf = memoryValues.slice(Math.floor(memoryValues.length / 2))
      
      const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length
      const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length
      
      const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100
      
      if (changePercent > 5) {
        trend = 'increasing'
      } else if (changePercent < -5) {
        trend = 'decreasing'
      }
    }

    return {
      samples: samples.length,
      avgMemoryUsage: avgMemory,
      peakMemoryUsage: peakMemory,
      memoryTrend: trend
    }
  }

  /**
   * Detect memory leaks by analyzing memory usage patterns
   */
  detectMemoryLeaks(operation: string, thresholdMB: number = 100): {
    isLeaking: boolean
    currentUsageMB: number
    trendMB: number
    recommendation: string
  } {
    const stats = this.getResourceStats(operation, 300000) // last 5 minutes
    
    if (!stats) {
      return {
        isLeaking: false,
        currentUsageMB: 0,
        trendMB: 0,
        recommendation: 'Insufficient data for leak detection'
      }
    }

    const currentUsageMB = stats.avgMemoryUsage / (1024 * 1024)
    const peakUsageMB = stats.peakMemoryUsage / (1024 * 1024)
    const trendMB = peakUsageMB - currentUsageMB

    const isLeaking = stats.memoryTrend === 'increasing' && currentUsageMB > thresholdMB

    let recommendation = 'Memory usage is within normal parameters'
    if (isLeaking) {
      recommendation = `Potential memory leak detected. Consider: 1) Reviewing object lifecycle management, 2) Checking for unclosed resources, 3) Implementing garbage collection hints`
    } else if (currentUsageMB > thresholdMB * 0.8) {
      recommendation = 'Memory usage is high but stable. Monitor for continued growth'
    }

    return {
      isLeaking,
      currentUsageMB,
      trendMB,
      recommendation
    }
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport(timeWindowMs: number = 300000): {
    timestamp: Date
    timeWindowMs: number
    operations: Record<string, {
      resourceStats: ReturnType<typeof this.getResourceStats>
      memoryLeakAnalysis: ReturnType<typeof this.detectMemoryLeaks>
      activeProfiles: number
    }>
    systemOverview: {
      totalMemoryUsage: number
      totalResourceSamples: number
      activeOperations: string[]
    }
  } {
    const operations: Record<string, any> = {}
    const uniqueOperations = [...new Set(this.resourceHistory.map(r => r.operation))]

    for (const operation of uniqueOperations) {
      operations[operation] = {
        resourceStats: this.getResourceStats(operation, timeWindowMs),
        memoryLeakAnalysis: this.detectMemoryLeaks(operation),
        activeProfiles: Array.from(this.profiles.keys()).filter(k => k.includes(operation)).length
      }
    }

    const currentMemory = process.memoryUsage()
    
    return {
      timestamp: new Date(),
      timeWindowMs,
      operations,
      systemOverview: {
        totalMemoryUsage: currentMemory.heapUsed,
        totalResourceSamples: this.resourceHistory.length,
        activeOperations: Array.from(this.profiles.keys())
      }
    }
  }

  /**
   * Clear old resource usage data
   */
  clearOldData(olderThanMs: number = 3600000): void {
    const cutoff = new Date(Date.now() - olderThanMs)
    const originalLength = this.resourceHistory.length
    
    this.resourceHistory.splice(0, this.resourceHistory.findIndex(r => r.timestamp >= cutoff))
    
    this.logger.debug('Cleared old performance data', {
      removedSamples: originalLength - this.resourceHistory.length,
      remainingSamples: this.resourceHistory.length,
      cutoffTime: cutoff.toISOString()
    })
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor()

// Setup periodic cleanup
setInterval(() => {
  performanceMonitor.clearOldData()
}, 600000) // every 10 minutes