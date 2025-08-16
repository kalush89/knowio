import { metricsCollector } from './metrics'
import { loggers } from '../logger'

export interface MemoryThresholds {
  warning: number // bytes
  critical: number // bytes
  maxHeapSize: number // bytes
}

export interface MemoryOptimizationOptions {
  enableGarbageCollection: boolean
  chunkProcessingLimit: number
  batchSizeReduction: number // percentage to reduce batch size when memory is high
  memoryCheckInterval: number // ms
}

export class MemoryManager {
  private readonly logger = loggers.memory
  private readonly thresholds: MemoryThresholds
  private readonly options: MemoryOptimizationOptions
  private memoryCheckInterval?: NodeJS.Timeout
  private isOptimizing = false

  constructor(
    thresholds?: Partial<MemoryThresholds>,
    options?: Partial<MemoryOptimizationOptions>
  ) {
    // Default thresholds (in bytes)
    this.thresholds = {
      warning: 512 * 1024 * 1024, // 512MB
      critical: 1024 * 1024 * 1024, // 1GB
      maxHeapSize: 2048 * 1024 * 1024, // 2GB
      ...thresholds
    }

    this.options = {
      enableGarbageCollection: true,
      chunkProcessingLimit: 1000,
      batchSizeReduction: 50, // reduce by 50%
      memoryCheckInterval: 10000, // 10 seconds
      ...options
    }

    this.startMemoryMonitoring()
  }

  /**
   * Check current memory usage and return status
   */
  checkMemoryUsage(): {
    status: 'normal' | 'warning' | 'critical'
    usage: NodeJS.MemoryUsage
    usagePercent: number
    recommendation: string
  } {
    const usage = process.memoryUsage()
    const usagePercent = (usage.heapUsed / this.thresholds.maxHeapSize) * 100

    let status: 'normal' | 'warning' | 'critical' = 'normal'
    let recommendation = 'Memory usage is within normal parameters'

    if (usage.heapUsed >= this.thresholds.critical) {
      status = 'critical'
      recommendation = 'Critical memory usage detected. Consider reducing batch sizes and triggering garbage collection'
    } else if (usage.heapUsed >= this.thresholds.warning) {
      status = 'warning'
      recommendation = 'High memory usage detected. Monitor closely and consider optimization'
    }

    // Record metrics
    metricsCollector.recordMetric({
      name: 'memory_usage_percent',
      value: usagePercent,
      unit: 'percentage',
      timestamp: new Date(),
      tags: { status }
    })

    return {
      status,
      usage,
      usagePercent,
      recommendation
    }
  }

  /**
   * Optimize memory usage for large document processing
   */
  async optimizeForLargeDocuments<T>(
    operation: string,
    processingFn: (optimizedParams: {
      batchSize: number
      shouldPause: boolean
      memoryStatus: string
    }) => Promise<T>
  ): Promise<T> {
    const operationId = `memory_opt_${operation}_${Date.now()}`
    this.logger.info('Starting memory-optimized processing', { operation, operationId })

    let batchSize = 100 // default batch size
    let pauseCount = 0

    try {
      while (true) {
        const memoryCheck = this.checkMemoryUsage()
        
        // Adjust batch size based on memory usage
        if (memoryCheck.status === 'critical') {
          batchSize = Math.max(1, Math.floor(batchSize * 0.25)) // reduce to 25%
          await this.forceGarbageCollection()
          await this.pause(5000) // pause for 5 seconds
          pauseCount++
          
          this.logger.warn('Critical memory usage - reducing batch size and pausing', {
            operation,
            newBatchSize: batchSize,
            pauseCount,
            memoryUsage: memoryCheck.usage.heapUsed
          })
        } else if (memoryCheck.status === 'warning') {
          batchSize = Math.max(1, Math.floor(batchSize * 0.5)) // reduce to 50%
          
          this.logger.info('High memory usage - reducing batch size', {
            operation,
            newBatchSize: batchSize,
            memoryUsage: memoryCheck.usage.heapUsed
          })
        }

        // Execute processing with optimized parameters
        const result = await processingFn({
          batchSize,
          shouldPause: memoryCheck.status !== 'normal',
          memoryStatus: memoryCheck.status
        })

        this.logger.info('Memory-optimized processing completed', {
          operation,
          finalBatchSize: batchSize,
          totalPauses: pauseCount,
          finalMemoryUsage: process.memoryUsage().heapUsed
        })

        return result
      }
    } catch (error) {
      this.logger.error('Memory-optimized processing failed', {
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
        batchSize,
        pauseCount
      })
      throw error
    }
  }

  /**
   * Process chunks with memory management
   */
  async processChunksWithMemoryManagement<T, R>(
    chunks: T[],
    processor: (chunk: T) => Promise<R>,
    options?: {
      initialBatchSize?: number
      maxConcurrency?: number
      memoryCheckFrequency?: number
    }
  ): Promise<R[]> {
    const initialBatchSize = options?.initialBatchSize || 50
    const maxConcurrency = options?.maxConcurrency || 5
    const memoryCheckFrequency = options?.memoryCheckFrequency || 10

    const results: R[] = []
    let currentBatchSize = initialBatchSize
    let processedCount = 0

    this.logger.info('Starting memory-managed chunk processing', {
      totalChunks: chunks.length,
      initialBatchSize,
      maxConcurrency
    })

    for (let i = 0; i < chunks.length; i += currentBatchSize) {
      // Check memory usage periodically
      if (processedCount % memoryCheckFrequency === 0) {
        const memoryCheck = this.checkMemoryUsage()
        
        if (memoryCheck.status === 'critical') {
          // Drastically reduce batch size and force GC
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize * 0.2))
          await this.forceGarbageCollection()
          await this.pause(2000)
          
          this.logger.warn('Critical memory - reducing batch size', {
            newBatchSize: currentBatchSize,
            memoryUsage: memoryCheck.usage.heapUsed
          })
        } else if (memoryCheck.status === 'warning') {
          // Moderately reduce batch size
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize * 0.7))
          
          this.logger.info('High memory - reducing batch size', {
            newBatchSize: currentBatchSize,
            memoryUsage: memoryCheck.usage.heapUsed
          })
        } else if (memoryCheck.status === 'normal' && currentBatchSize < initialBatchSize) {
          // Gradually increase batch size back to normal
          currentBatchSize = Math.min(initialBatchSize, Math.floor(currentBatchSize * 1.2))
          
          this.logger.debug('Memory normalized - increasing batch size', {
            newBatchSize: currentBatchSize
          })
        }
      }

      // Process current batch
      const batch = chunks.slice(i, i + currentBatchSize)
      const batchPromises = batch.map(chunk => processor(chunk))
      
      try {
        const batchResults = await Promise.all(batchPromises)
        results.push(...batchResults)
        processedCount += batch.length
        
        // Record progress metrics
        metricsCollector.recordMetric({
          name: 'chunk_processing_progress',
          value: (processedCount / chunks.length) * 100,
          unit: 'percentage',
          timestamp: new Date(),
          tags: { 
            batch_size: currentBatchSize.toString(),
            processed: processedCount.toString(),
            total: chunks.length.toString()
          }
        })

        this.logger.debug('Batch processed successfully', {
          batchSize: batch.length,
          processedCount,
          totalChunks: chunks.length,
          progress: Math.round((processedCount / chunks.length) * 100)
        })

      } catch (error) {
        this.logger.error('Batch processing failed', {
          batchSize: batch.length,
          processedCount,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        
        // Continue with next batch instead of failing completely
        continue
      }

      // Small pause between batches to allow GC
      if (i + currentBatchSize < chunks.length) {
        await this.pause(100)
      }
    }

    this.logger.info('Memory-managed chunk processing completed', {
      totalChunks: chunks.length,
      processedChunks: results.length,
      finalBatchSize: currentBatchSize,
      successRate: Math.round((results.length / chunks.length) * 100)
    })

    return results
  }

  /**
   * Force garbage collection if available
   */
  async forceGarbageCollection(): Promise<void> {
    if (!this.options.enableGarbageCollection) {
      return
    }

    const beforeGC = process.memoryUsage()
    
    if (global.gc) {
      global.gc()
      const afterGC = process.memoryUsage()
      const freedMemory = beforeGC.heapUsed - afterGC.heapUsed
      
      this.logger.info('Garbage collection completed', {
        freedMemory,
        beforeHeapUsed: beforeGC.heapUsed,
        afterHeapUsed: afterGC.heapUsed,
        freedMB: Math.round(freedMemory / (1024 * 1024))
      })

      metricsCollector.recordMetric({
        name: 'gc_memory_freed',
        value: freedMemory,
        unit: 'bytes',
        timestamp: new Date()
      })
    } else {
      this.logger.warn('Garbage collection not available - run with --expose-gc flag')
    }
  }

  /**
   * Get memory optimization recommendations
   */
  getOptimizationRecommendations(): {
    currentStatus: string
    recommendations: string[]
    suggestedBatchSize: number
    shouldReduceParallelism: boolean
  } {
    const memoryCheck = this.checkMemoryUsage()
    const recommendations: string[] = []
    let suggestedBatchSize = 100
    let shouldReduceParallelism = false

    if (memoryCheck.status === 'critical') {
      recommendations.push('Immediately reduce batch sizes to minimum (1-5 items)')
      recommendations.push('Enable garbage collection between operations')
      recommendations.push('Consider processing documents sequentially instead of in parallel')
      recommendations.push('Implement streaming processing for very large documents')
      suggestedBatchSize = 5
      shouldReduceParallelism = true
    } else if (memoryCheck.status === 'warning') {
      recommendations.push('Reduce batch sizes by 50%')
      recommendations.push('Increase pause intervals between batches')
      recommendations.push('Monitor memory usage more frequently')
      suggestedBatchSize = 25
      shouldReduceParallelism = true
    } else {
      recommendations.push('Memory usage is optimal')
      recommendations.push('Current batch sizes can be maintained or increased')
      suggestedBatchSize = 100
    }

    return {
      currentStatus: memoryCheck.status,
      recommendations,
      suggestedBatchSize,
      shouldReduceParallelism
    }
  }

  /**
   * Start continuous memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.memoryCheckInterval = setInterval(() => {
      const memoryCheck = this.checkMemoryUsage()
      
      if (memoryCheck.status !== 'normal' && !this.isOptimizing) {
        this.logger.warn('Memory usage alert', {
          status: memoryCheck.status,
          usagePercent: Math.round(memoryCheck.usagePercent),
          recommendation: memoryCheck.recommendation
        })

        // Auto-optimize if critical
        if (memoryCheck.status === 'critical') {
          this.autoOptimize()
        }
      }
    }, this.options.memoryCheckInterval)
  }

  /**
   * Automatic memory optimization
   */
  private async autoOptimize(): Promise<void> {
    if (this.isOptimizing) {
      return
    }

    this.isOptimizing = true
    this.logger.info('Starting automatic memory optimization')

    try {
      await this.forceGarbageCollection()
      await this.pause(1000)
      
      const afterOptimization = this.checkMemoryUsage()
      this.logger.info('Automatic memory optimization completed', {
        status: afterOptimization.status,
        usagePercent: Math.round(afterOptimization.usagePercent)
      })
    } catch (error) {
      this.logger.error('Automatic memory optimization failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      this.isOptimizing = false
    }
  }

  /**
   * Utility function to pause execution
   */
  private pause(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval)
      this.memoryCheckInterval = undefined
    }
  }

  /**
   * Get current memory thresholds
   */
  getThresholds(): MemoryThresholds {
    return { ...this.thresholds }
  }

  /**
   * Update memory thresholds
   */
  updateThresholds(newThresholds: Partial<MemoryThresholds>): void {
    Object.assign(this.thresholds, newThresholds)
    this.logger.info('Memory thresholds updated', this.thresholds)
  }
}

// Global memory manager instance
export const memoryManager = new MemoryManager()

// Graceful shutdown
process.on('beforeExit', () => {
  memoryManager.stopMonitoring()
})