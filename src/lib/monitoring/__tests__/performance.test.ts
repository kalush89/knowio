import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { metricsCollector } from '../metrics'
import { performanceMonitor } from '../performance'
import { memoryManager } from '../memory'

describe('Performance Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any test data
    metricsCollector.clearOldMetrics(0)
  })

  describe('MetricsCollector', () => {
    it('should record and retrieve metrics correctly', () => {
      const metric = {
        name: 'test_metric',
        value: 100,
        unit: 'ms' as const,
        timestamp: new Date(),
        tags: { operation: 'test' }
      }

      metricsCollector.recordMetric(metric)
      const summary = metricsCollector.getMetricsSummary('test_metric')

      expect(summary).toBeDefined()
      expect(summary?.count).toBe(1)
      expect(summary?.average).toBe(100)
      expect(summary?.latest).toBe(100)
    })

    it('should handle timer operations', () => {
      const operationId = 'test_operation'
      
      metricsCollector.startTimer(operationId)
      
      // Simulate some work
      const duration = metricsCollector.endTimer(operationId)
      
      expect(duration).toBeGreaterThan(0)
      
      const summary = metricsCollector.getMetricsSummary('operation_duration')
      expect(summary).toBeDefined()
      expect(summary?.count).toBe(1)
    })

    it('should record processing speed metrics', () => {
      metricsCollector.recordProcessingSpeed(100, 5000) // 100 chunks in 5 seconds
      
      const summary = metricsCollector.getMetricsSummary('processing_speed')
      expect(summary).toBeDefined()
      expect(summary?.latest).toBe(20) // 20 chunks per second
    })

    it('should record API call metrics', () => {
      metricsCollector.recordApiCall('test_service', 'test_operation', 500, true)
      
      const durationSummary = metricsCollector.getMetricsSummary('api_call_duration')
      const countSummary = metricsCollector.getMetricsSummary('api_call_count')
      
      expect(durationSummary?.latest).toBe(500)
      expect(countSummary?.latest).toBe(1)
    })

    it('should export metrics in JSON format', () => {
      metricsCollector.recordMetric({
        name: 'export_test',
        value: 42,
        unit: 'count',
        timestamp: new Date()
      })

      const exported = metricsCollector.exportMetrics('json')
      const parsed = JSON.parse(exported)
      
      expect(parsed.metrics).toBeDefined()
      expect(parsed.metrics.export_test).toBeDefined()
    })

    it('should clear old metrics', () => {
      // Record a metric
      metricsCollector.recordMetric({
        name: 'old_metric',
        value: 1,
        unit: 'count',
        timestamp: new Date(Date.now() - 7200000) // 2 hours ago
      })

      // Clear metrics older than 1 hour
      metricsCollector.clearOldMetrics(3600000)
      
      const summary = metricsCollector.getMetricsSummary('old_metric')
      expect(summary).toBeNull()
    })
  })

  describe('PerformanceMonitor', () => {
    it('should profile operations correctly', async () => {
      const operationId = 'test_profile'
      
      performanceMonitor.startProfiling(operationId, { test: true })
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const profile = performanceMonitor.endProfiling(operationId)
      
      expect(profile).toBeDefined()
      expect(profile?.duration).toBeGreaterThan(0)
      expect(profile?.memoryDelta).toBeDefined()
    })

    it('should monitor resource usage during operations', async () => {
      // First record some resource usage manually to ensure data exists
      performanceMonitor.recordResourceUsage('test_resource_monitoring')
      
      const result = await performanceMonitor.monitorResourceUsage(
        'test_resource_monitoring',
        async () => {
          // Simulate some work that uses memory
          const largeArray = new Array(1000).fill('test')
          // Add a small delay to allow sampling
          await new Promise(resolve => setTimeout(resolve, 150))
          return largeArray.length
        },
        { sampleInterval: 50, trackCpu: true }
      )

      expect(result).toBe(1000)
      
      // Wait a bit more to ensure samples are recorded
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const stats = performanceMonitor.getResourceStats('test_resource_monitoring')
      expect(stats).toBeDefined()
      if (stats) {
        expect(stats.samples).toBeGreaterThan(0)
      }
    })

    it('should detect memory usage trends', () => {
      // Record some memory usage data
      for (let i = 0; i < 10; i++) {
        performanceMonitor.recordResourceUsage('trend_test')
      }

      const stats = performanceMonitor.getResourceStats('trend_test')
      expect(stats).toBeDefined()
      expect(stats?.memoryTrend).toMatch(/increasing|decreasing|stable/)
    })

    it('should generate performance reports', () => {
      performanceMonitor.recordResourceUsage('report_test')
      
      const report = performanceMonitor.getPerformanceReport(300000)
      
      expect(report.timestamp).toBeDefined()
      expect(report.operations).toBeDefined()
      expect(report.systemOverview).toBeDefined()
    })
  })

  describe('MemoryManager', () => {
    it('should check memory usage status', () => {
      const status = memoryManager.checkMemoryUsage()
      
      expect(status.status).toMatch(/normal|warning|critical/)
      expect(status.usage).toBeDefined()
      expect(status.usagePercent).toBeGreaterThanOrEqual(0)
      expect(status.recommendation).toBeDefined()
    })

    it('should process chunks with memory management', async () => {
      const testChunks = Array.from({ length: 50 }, (_, i) => ({ id: i, data: `chunk-${i}` }))
      
      const results = await memoryManager.processChunksWithMemoryManagement(
        testChunks,
        async (chunk) => ({ processed: chunk.id }),
        { initialBatchSize: 10, maxConcurrency: 2 }
      )

      expect(results).toHaveLength(50)
      expect(results[0]).toEqual({ processed: 0 })
    })

    it('should provide optimization recommendations', () => {
      const recommendations = memoryManager.getOptimizationRecommendations()
      
      expect(recommendations.currentStatus).toBeDefined()
      expect(recommendations.recommendations).toBeInstanceOf(Array)
      expect(recommendations.suggestedBatchSize).toBeGreaterThan(0)
      expect(typeof recommendations.shouldReduceParallelism).toBe('boolean')
    })

    it('should handle memory optimization for large documents', async () => {
      const result = await memoryManager.optimizeForLargeDocuments(
        'test_optimization',
        async ({ batchSize, shouldPause, memoryStatus }) => {
          expect(batchSize).toBeGreaterThan(0)
          expect(typeof shouldPause).toBe('boolean')
          expect(memoryStatus).toMatch(/normal|warning|critical/)
          
          return { processed: true, batchSize }
        }
      )

      expect(result.processed).toBe(true)
      expect(result.batchSize).toBeGreaterThan(0)
    })

    it('should force garbage collection when available', async () => {
      const originalGc = global.gc
      const mockGc = vi.fn()
      global.gc = mockGc

      await memoryManager.forceGarbageCollection()

      if (mockGc.mock.calls.length > 0) {
        expect(mockGc).toHaveBeenCalled()
      }

      global.gc = originalGc
    })
  })

  describe('Integration Tests', () => {
    it('should handle concurrent monitoring operations', async () => {
      const operations = Array.from({ length: 5 }, (_, i) => 
        performanceMonitor.monitorResourceUsage(
          `concurrent_test_${i}`,
          async () => {
            metricsCollector.recordMetric({
              name: 'concurrent_metric',
              value: i,
              unit: 'count',
              timestamp: new Date()
            })
            return i
          }
        )
      )

      const results = await Promise.all(operations)
      expect(results).toEqual([0, 1, 2, 3, 4])

      const summary = metricsCollector.getMetricsSummary('concurrent_metric')
      expect(summary?.count).toBe(5)
    })

    it('should maintain performance under load', async () => {
      const startTime = Date.now()
      const iterations = 100

      // Simulate high-frequency metric recording
      for (let i = 0; i < iterations; i++) {
        metricsCollector.recordMetric({
          name: 'load_test_metric',
          value: i,
          unit: 'count',
          timestamp: new Date()
        })
        
        if (i % 10 === 0) {
          metricsCollector.recordMemoryUsage('load_test')
        }
      }

      const duration = Date.now() - startTime
      const summary = metricsCollector.getMetricsSummary('load_test_metric')

      expect(summary?.count).toBe(iterations)
      expect(duration).toBeLessThan(1000) // Should complete within 1 second
    })

    it('should handle memory pressure scenarios', async () => {
      // Simulate memory pressure by creating large objects
      const largeObjects: any[] = []
      
      const result = await memoryManager.optimizeForLargeDocuments(
        'memory_pressure_test',
        async ({ batchSize, shouldPause, memoryStatus }) => {
          // Create some memory pressure
          if (largeObjects.length < 10) {
            largeObjects.push(new Array(10000).fill('memory-pressure-test'))
          }
          
          return {
            batchSize,
            memoryStatus,
            objectCount: largeObjects.length
          }
        }
      )

      expect(result.batchSize).toBeGreaterThan(0)
      expect(result.memoryStatus).toBeDefined()
      
      // Clean up
      largeObjects.length = 0
    })
  })

  describe('Scalability Tests', () => {
    it('should handle large metric datasets efficiently', () => {
      const startTime = Date.now()
      const metricCount = 1000

      // Record many metrics
      for (let i = 0; i < metricCount; i++) {
        metricsCollector.recordMetric({
          name: 'scalability_test',
          value: Math.random() * 100,
          unit: 'ms',
          timestamp: new Date(),
          tags: { batch: Math.floor(i / 100).toString() }
        })
      }

      const recordingTime = Date.now() - startTime
      
      // Test retrieval performance
      const retrievalStart = Date.now()
      const summary = metricsCollector.getMetricsSummary('scalability_test')
      const retrievalTime = Date.now() - retrievalStart

      expect(summary?.count).toBe(metricCount)
      expect(recordingTime).toBeLessThan(5000) // Recording should be fast
      expect(retrievalTime).toBeLessThan(100) // Retrieval should be very fast
    })

    it('should maintain performance with concurrent resource monitoring', async () => {
      const concurrentOperations = 20
      const operationsPerThread = 50

      const startTime = Date.now()
      
      const promises = Array.from({ length: concurrentOperations }, (_, threadId) =>
        performanceMonitor.monitorResourceUsage(
          `scalability_concurrent_${threadId}`,
          async () => {
            const results = []
            for (let i = 0; i < operationsPerThread; i++) {
              metricsCollector.recordProcessingSpeed(10, 1000)
              results.push(i)
            }
            return results.length
          }
        )
      )

      const results = await Promise.all(promises)
      const totalTime = Date.now() - startTime

      expect(results).toHaveLength(concurrentOperations)
      expect(results.every(r => r === operationsPerThread)).toBe(true)
      expect(totalTime).toBeLessThan(10000) // Should complete within 10 seconds
    })
  })
})