import { NextRequest, NextResponse } from 'next/server'
import { metricsCollector } from '@/lib/monitoring/metrics'
import { performanceMonitor } from '@/lib/monitoring/performance'
import { memoryManager } from '@/lib/monitoring/memory'
import { dbMonitor } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json'
    const timeWindow = parseInt(searchParams.get('timeWindow') || '300000') // 5 minutes default
    const component = searchParams.get('component')

    // Get comprehensive monitoring data
    const monitoringData = {
      timestamp: new Date().toISOString(),
      timeWindowMs: timeWindow,
      
      // System metrics
      systemMetrics: metricsCollector.getSystemMetrics('api', 'monitoring'),
      
      // Performance data
      performanceReport: performanceMonitor.getPerformanceReport(timeWindow),
      
      // Memory status
      memoryStatus: memoryManager.checkMemoryUsage(),
      memoryRecommendations: memoryManager.getOptimizationRecommendations(),
      
      // Database statistics
      databaseStats: dbMonitor.getConnectionStats(),
      
      // Key metrics summaries
      keyMetrics: {
        processingSpeed: metricsCollector.getMetricsSummary('processing_speed', timeWindow),
        apiCallDuration: metricsCollector.getMetricsSummary('api_call_duration', timeWindow),
        memoryUsage: metricsCollector.getMetricsSummary('memory_heap_used', timeWindow),
        dbQueryDuration: metricsCollector.getMetricsSummary('db_query_duration', timeWindow),
        embeddingSuccessRate: metricsCollector.getMetricsSummary('embedding_success_rate', timeWindow),
        vectorStorageSuccessRate: metricsCollector.getMetricsSummary('vector_storage_success_rate', timeWindow)
      }
    }

    // Filter by component if specified
    if (component) {
      const componentMetrics = Object.entries(monitoringData.keyMetrics)
        .filter(([key]) => key.toLowerCase().includes(component.toLowerCase()))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
      
      return NextResponse.json({
        ...monitoringData,
        keyMetrics: componentMetrics,
        filteredBy: component
      })
    }

    // Return in requested format
    if (format === 'prometheus') {
      const prometheusData = metricsCollector.exportMetrics('prometheus')
      return new NextResponse(prometheusData, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      })
    }

    return NextResponse.json(monitoringData)

  } catch (error) {
    console.error('Failed to retrieve monitoring metrics:', error)
    
    return NextResponse.json(
      {
        error: 'Failed to retrieve monitoring metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, parameters } = body

    switch (action) {
      case 'clearOldMetrics':
        const olderThanMs = parameters?.olderThanMs || 3600000 // 1 hour default
        metricsCollector.clearOldMetrics(olderThanMs)
        performanceMonitor.clearOldData(olderThanMs)
        
        return NextResponse.json({
          success: true,
          message: `Cleared metrics older than ${olderThanMs}ms`,
          timestamp: new Date().toISOString()
        })

      case 'forceGarbageCollection':
        await memoryManager.forceGarbageCollection()
        
        return NextResponse.json({
          success: true,
          message: 'Garbage collection triggered',
          memoryAfter: process.memoryUsage(),
          timestamp: new Date().toISOString()
        })

      case 'optimizeDatabase':
        await dbMonitor.optimizeConnections()
        
        return NextResponse.json({
          success: true,
          message: 'Database connections optimized',
          connectionStats: dbMonitor.getConnectionStats(),
          timestamp: new Date().toISOString()
        })

      case 'recordCustomMetric':
        const { name, value, unit, tags } = parameters
        if (!name || value === undefined || !unit) {
          return NextResponse.json(
            { error: 'Missing required parameters: name, value, unit' },
            { status: 400 }
          )
        }

        metricsCollector.recordMetric({
          name,
          value,
          unit,
          timestamp: new Date(),
          tags
        })

        return NextResponse.json({
          success: true,
          message: `Custom metric '${name}' recorded`,
          timestamp: new Date().toISOString()
        })

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Failed to process monitoring action:', error)
    
    return NextResponse.json(
      {
        error: 'Failed to process monitoring action',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}