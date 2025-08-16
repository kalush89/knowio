import { z } from 'zod'

// Helper function to parse boolean environment variables
// ISSUE: Repeated boolean parsing logic violates DRY principle
const parseBoolean = (defaultValue: boolean = false) => 
  z.string().transform(val => val === 'true').default(defaultValue.toString())

// Helper function to parse integer environment variables with validation
// ISSUE: Repeated integer parsing logic violates DRY principle
const parseInteger = (defaultValue: number, min?: number, max?: number) => {
  let schema = z.string().transform(val => {
    const parsed = parseInt(val, 10)
    if (isNaN(parsed)) {
      throw new Error(`Invalid integer value: ${val}`)
    }
    return parsed
  }).default(defaultValue.toString())
  
  if (min !== undefined) {
    schema = schema.refine(val => val >= min, { message: `Value must be >= ${min}` })
  }
  if (max !== undefined) {
    schema = schema.refine(val => val <= max, { message: `Value must be <= ${max}` })
  }
  
  return schema
}

// Environment configuration schema
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

  // AWS Configuration
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),

  // Inngest Configuration
  INNGEST_EVENT_KEY: z.string().min(1, 'INNGEST_EVENT_KEY is required'),
  INNGEST_SIGNING_KEY: z.string().min(1, 'INNGEST_SIGNING_KEY is required'),

  // Next.js Configuration
  NEXTAUTH_URL: z.string().url('NEXTAUTH_URL must be a valid URL'),
  NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),

  // Monitoring Configuration
  ENABLE_METRICS: parseBoolean(true),
  METRICS_RETENTION_HOURS: parseInteger(24, 1, 168), // 1 hour to 1 week

  // Performance Configuration
  MAX_CONCURRENT_JOBS: parseInteger(5, 1, 50),
  EMBEDDING_BATCH_SIZE: parseInteger(10, 1, 100),
  SCRAPING_TIMEOUT_MS: parseInteger(30000, 1000, 300000), // 1s to 5min

  // Security Configuration (Production)
  RATE_LIMIT_REQUESTS_PER_MINUTE: parseInteger(100, 1, 10000).optional(),
  ENABLE_REQUEST_LOGGING: parseBoolean().optional(),

  // Error Reporting (Production)
  ENABLE_ERROR_REPORTING: parseBoolean().optional(),
  ERROR_REPORTING_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),

  // Production-specific settings
  HEALTH_CHECK_API_KEY: z.string().optional(),
  DEPLOYMENT_VERSION: z.string().optional(),
  DEPLOYMENT_ENVIRONMENT: z.string().optional(),

  // Database connection pooling
  DATABASE_MAX_CONNECTIONS: parseInteger(20, 1, 100).optional(),
  DATABASE_CONNECTION_TIMEOUT: parseInteger(30000, 1000, 120000).optional(), // 1s to 2min

  // Monitoring and alerting
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  METRICS_EXPORT_INTERVAL: parseInteger(60000, 10000, 3600000).optional(), // 10s to 1hour
})

export type Environment = z.infer<typeof environmentSchema>

// Validate and export environment configuration
// ISSUE: Function name could be more descriptive about what it returns
function parseAndValidateEnvironment(): Environment {
  try {
    return environmentSchema.parse(process.env)
  } catch (error) {
    // ISSUE: Using console.error instead of proper logging system
    // TODO: Replace with structured logging once logger is available
    console.error('Environment validation failed:', error)
    
    // ISSUE: Generic error message loses context about which variables failed
    if (error instanceof z.ZodError) {
      const failedFields = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      throw new Error(`Environment validation failed for: ${failedFields}`)
    }
    
    throw new Error('Invalid environment configuration')
  }
}

export const env = parseAndValidateEnvironment()

// Environment-specific configurations
export const isDevelopment = env.NODE_ENV === 'development'
export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

// ISSUE: These configuration objects violate SRP by mixing concerns
// Consider splitting into separate modules for better maintainability

// Database configuration factory
// REFACTOR: Extract to separate module if this grows larger
function createDatabaseConfig() {
  return {
    url: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
    maxConnections: env.DATABASE_MAX_CONNECTIONS ?? (isProduction ? 20 : 5),
    connectionTimeout: env.DATABASE_CONNECTION_TIMEOUT ?? (isProduction ? 60000 : 30000),
  } as const
}

// AWS configuration factory
function createAwsConfig() {
  return {
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    maxRetries: isProduction ? 5 : 3,
    timeout: isProduction ? 60000 : 30000,
  } as const
}

// Inngest configuration factory
function createInngestConfig() {
  return {
    eventKey: env.INNGEST_EVENT_KEY,
    signingKey: env.INNGEST_SIGNING_KEY,
    isDev: isDevelopment,
  } as const
}

// Monitoring configuration factory
function createMonitoringConfig() {
  return {
    enabled: env.ENABLE_METRICS,
    retentionHours: env.METRICS_RETENTION_HOURS,
    logLevel: env.LOG_LEVEL,
    enableRequestLogging: env.ENABLE_REQUEST_LOGGING ?? isProduction,
    enableErrorReporting: env.ENABLE_ERROR_REPORTING ?? isProduction,
    errorReportingLevel: env.ERROR_REPORTING_LEVEL ?? 'error',
  } as const
}

// Performance configuration factory
function createPerformanceConfig() {
  return {
    maxConcurrentJobs: env.MAX_CONCURRENT_JOBS,
    embeddingBatchSize: env.EMBEDDING_BATCH_SIZE,
    scrapingTimeoutMs: env.SCRAPING_TIMEOUT_MS,
    rateLimitRequestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE ?? (isProduction ? 100 : 1000),
  } as const
}

// Security configuration factory
function createSecurityConfig() {
  // ISSUE: Hardcoded CORS origins should be configurable
  const developmentOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000']
  const productionOrigins = [env.NEXTAUTH_URL]
  
  return {
    rateLimitEnabled: isProduction,
    requestLoggingEnabled: env.ENABLE_REQUEST_LOGGING ?? isProduction,
    corsOrigins: isProduction ? productionOrigins : developmentOrigins,
  } as const
}

// Logging configuration factory
function createLoggingConfig() {
  // ISSUE: Hardcoded values should be configurable
  const DEFAULT_MAX_FILE_SIZE = '10MB'
  const DEFAULT_MAX_FILES = 5
  
  return {
    level: env.LOG_LEVEL,
    enableConsole: true,
    enableFile: isProduction,
    enableStructured: isProduction,
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    maxFiles: DEFAULT_MAX_FILES,
  } as const
}

// Production deployment configuration factory
function createDeploymentConfig() {
  const DEFAULT_METRICS_INTERVAL_PROD = 60000  // 1 minute
  const DEFAULT_METRICS_INTERVAL_DEV = 300000  // 5 minutes
  
  return {
    version: env.DEPLOYMENT_VERSION ?? 'unknown',
    environment: env.DEPLOYMENT_ENVIRONMENT ?? env.NODE_ENV,
    healthCheckApiKey: env.HEALTH_CHECK_API_KEY,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL,
    metricsExportInterval: env.METRICS_EXPORT_INTERVAL ?? 
      (isProduction ? DEFAULT_METRICS_INTERVAL_PROD : DEFAULT_METRICS_INTERVAL_DEV),
  } as const
}

// Export configuration objects (lazy-loaded for better performance)
export const databaseConfig = createDatabaseConfig()
export const awsConfig = createAwsConfig()
export const inngestConfig = createInngestConfig()
export const monitoringConfig = createMonitoringConfig()
export const performanceConfig = createPerformanceConfig()
export const securityConfig = createSecurityConfig()
export const loggingConfig = createLoggingConfig()
export const deploymentConfig = createDeploymentConfig()