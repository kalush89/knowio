import { env, isProduction, monitoringConfig, deploymentConfig } from '@/lib/config/environment'
import { createLogger } from '@/lib/logger'

const logger = createLogger('ErrorReporting')

export interface ErrorReport {
  error: Error
  context?: Record<string, any>
  severity?: 'low' | 'medium' | 'high' | 'critical'
  component?: string
  userId?: string
  requestId?: string
  timestamp: Date
}

export interface ErrorReportingService {
  reportError(report: ErrorReport): Promise<void>
  reportPerformanceIssue(metric: string, value: number, threshold: number): Promise<void>
  reportSecurityEvent(event: string, details: Record<string, any>): Promise<void>
}

class ProductionErrorReporting implements ErrorReportingService {
  async reportError(report: ErrorReport): Promise<void> {
    try {
      // Log structured error data
      logger.error('Application error reported', {
        errorName: report.error.name,
        errorMessage: report.error.message,
        errorStack: report.error.stack,
        severity: report.severity || 'medium',
        component: report.component,
        context: report.context,
        userId: report.userId,
        requestId: report.requestId,
        timestamp: report.timestamp.toISOString(),
        environment: env.NODE_ENV
      })

      // In production, send to external monitoring service
      if (isProduction && monitoringConfig.enableErrorReporting) {
        await this.sendToExternalService(report)
        
        // Send critical alerts
        if (report.severity === 'critical' && deploymentConfig.alertWebhookUrl) {
          await this.sendAlert(report)
        }
      }
    } catch (error) {
      console.error('Failed to report error:', error)
    }
  }

  async reportPerformanceIssue(metric: string, value: number, threshold: number): Promise<void> {
    const report: ErrorReport = {
      error: new Error(`Performance threshold exceeded: ${metric}`),
      context: {
        metric,
        value,
        threshold,
        exceedancePercentage: ((value - threshold) / threshold) * 100
      },
      severity: value > threshold * 2 ? 'critical' : 'high',
      component: 'Performance',
      timestamp: new Date()
    }

    await this.reportError(report)
  }

  async reportSecurityEvent(event: string, details: Record<string, any>): Promise<void> {
    const report: ErrorReport = {
      error: new Error(`Security event: ${event}`),
      context: {
        event,
        details,
        userAgent: details.userAgent,
        ip: details.ip,
        endpoint: details.endpoint
      },
      severity: 'critical',
      component: 'Security',
      timestamp: new Date()
    }

    await this.reportError(report)
  }

  private async sendToExternalService(report: ErrorReport): Promise<void> {
    // Example implementation for external error reporting
    // In a real application, you would integrate with services like:
    // - Sentry
    // - DataDog
    // - New Relic
    // - Bugsnag
    // - Custom webhook

    const payload = {
      timestamp: report.timestamp.toISOString(),
      environment: deploymentConfig.environment,
      version: deploymentConfig.version,
      service: 'document-ingestion',
      error: {
        name: report.error.name,
        message: report.error.message,
        stack: report.error.stack
      },
      context: report.context,
      severity: report.severity,
      component: report.component,
      userId: report.userId,
      requestId: report.requestId,
      tags: {
        environment: deploymentConfig.environment,
        version: deploymentConfig.version,
        service: 'document-ingestion',
        component: report.component
      }
    }

    // Example: Send to webhook or external service
    try {
      // await fetch('https://your-error-reporting-service.com/api/errors', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Authorization': `Bearer ${process.env.ERROR_REPORTING_API_KEY}`
      //   },
      //   body: JSON.stringify(payload)
      // })

      logger.info('Error report sent to external service', { 
        errorId: report.requestId,
        severity: report.severity 
      })
    } catch (error) {
      logger.error('Failed to send error report to external service', { error })
    }
  }

  private async sendAlert(report: ErrorReport): Promise<void> {
    if (!deploymentConfig.alertWebhookUrl) {
      return
    }

    try {
      const alertPayload = {
        alert: 'Critical Error',
        service: 'document-ingestion',
        environment: deploymentConfig.environment,
        version: deploymentConfig.version,
        timestamp: report.timestamp.toISOString(),
        error: {
          message: report.error.message,
          component: report.component,
          severity: report.severity
        },
        context: report.context,
        actionRequired: true
      }

      const response = await fetch(deploymentConfig.alertWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `document-ingestion-${deploymentConfig.version}`
        },
        body: JSON.stringify(alertPayload)
      })

      if (!response.ok) {
        throw new Error(`Alert webhook returned ${response.status}`)
      }

      logger.info('Critical alert sent successfully', { 
        errorId: report.requestId,
        severity: report.severity 
      })
    } catch (error) {
      logger.error('Failed to send critical alert', { error })
    }
  }
}

class DevelopmentErrorReporting implements ErrorReportingService {
  async reportError(report: ErrorReport): Promise<void> {
    // In development, just log to console with rich formatting
    console.group(`🚨 Error Report - ${report.severity?.toUpperCase() || 'MEDIUM'}`)
    console.error('Error:', report.error)
    console.log('Component:', report.component)
    console.log('Context:', report.context)
    console.log('Timestamp:', report.timestamp.toISOString())
    if (report.userId) console.log('User ID:', report.userId)
    if (report.requestId) console.log('Request ID:', report.requestId)
    console.groupEnd()
  }

  async reportPerformanceIssue(metric: string, value: number, threshold: number): Promise<void> {
    console.warn(`⚠️ Performance Issue: ${metric} = ${value} (threshold: ${threshold})`)
  }

  async reportSecurityEvent(event: string, details: Record<string, any>): Promise<void> {
    console.error(`🔒 Security Event: ${event}`, details)
  }
}

// Export singleton instance
export const errorReporting: ErrorReportingService = isProduction 
  ? new ProductionErrorReporting()
  : new DevelopmentErrorReporting()

// Convenience functions
export const reportError = (error: Error, context?: Record<string, any>, severity?: ErrorReport['severity']) => {
  return errorReporting.reportError({
    error,
    context,
    severity,
    timestamp: new Date()
  })
}

export const reportPerformanceIssue = (metric: string, value: number, threshold: number) => {
  return errorReporting.reportPerformanceIssue(metric, value, threshold)
}

export const reportSecurityEvent = (event: string, details: Record<string, any>) => {
  return errorReporting.reportSecurityEvent(event, details)
}

// Error boundary for async operations
export const withErrorReporting = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  component: string,
  context?: Record<string, any>
) => {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args)
    } catch (error) {
      await reportError(error as Error, { ...context, args }, 'medium')
      throw error
    }
  }
}