#!/usr/bin/env tsx

/**
 * Environment Validation Script
 * 
 * This script validates all environment variables and external service connections
 * required for the RAG system to function properly.
 */

import { PrismaClient } from '@prisma/client'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { z } from 'zod'

// Console colors
const colors = {
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

// Environment validation schema
const validationSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),

    // Database
    DATABASE_URL: z.string().min(1),
    DIRECT_URL: z.string().min(1),

    // AWS Configuration
    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),

    // Inngest Configuration
    INNGEST_EVENT_KEY: z.string().min(1),
    INNGEST_SIGNING_KEY: z.string().min(1),

    // Next.js Configuration
    NEXTAUTH_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),
})

interface ValidationResult {
    success: boolean
    message: string
    details?: string
}

class EnvironmentValidator {
    private results: ValidationResult[] = []
    private hasErrors = false

    private log(result: ValidationResult) {
        this.results.push(result)
        if (!result.success) {
            this.hasErrors = true
        }

        const icon = result.success ? colors.green('✓') : colors.red('✗')
        const message = result.success ? colors.green(result.message) : colors.red(result.message)
        console.log(`${icon} ${message}`)

        if (result.details) {
            console.log(`  ${colors.gray(result.details)}`)
        }
    }

    async validateEnvironmentVariables(): Promise<void> {
        console.log(colors.blue('\n🔍 Validating Environment Variables...\n'))

        try {
            const env = validationSchema.parse(process.env)
            this.log({
                success: true,
                message: 'All required environment variables are present and valid'
            })

            // Additional validations
            this.validateDatabaseUrl(env.DATABASE_URL)
            this.validateAwsCredentials(env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY)
            this.validateNextAuthSecret(env.NEXTAUTH_SECRET)

        } catch (error) {
            if (error instanceof z.ZodError) {
                error.errors.forEach(err => {
                    this.log({
                        success: false,
                        message: `Environment variable validation failed: ${err.path.join('.')}`,
                        details: err.message
                    })
                })
            } else {
                this.log({
                    success: false,
                    message: 'Environment validation failed',
                    details: error instanceof Error ? error.message : String(error)
                })
            }
        }
    }

    private validateDatabaseUrl(url: string): void {
        try {
            const parsed = new URL(url)
            if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
                throw new Error('Database URL must use postgresql:// or postgres:// protocol')
            }

            this.log({
                success: true,
                message: 'Database URL format is valid',
                details: `Protocol: ${parsed.protocol}, Host: ${parsed.hostname}`
            })
        } catch (error) {
            this.log({
                success: false,
                message: 'Invalid database URL format',
                details: error instanceof Error ? error.message : String(error)
            })
        }
    }

    private validateAwsCredentials(accessKeyId: string, secretAccessKey: string): void {
        // Basic format validation
        const accessKeyPattern = /^AKIA[0-9A-Z]{16}$/
        const isValidAccessKey = accessKeyPattern.test(accessKeyId) || accessKeyId.startsWith('ASIA')

        if (!isValidAccessKey) {
            this.log({
                success: false,
                message: 'AWS Access Key ID format appears invalid',
                details: 'Should start with AKIA (IAM user) or ASIA (temporary credentials)'
            })
        } else {
            this.log({
                success: true,
                message: 'AWS Access Key ID format is valid'
            })
        }

        if (secretAccessKey.length !== 40) {
            this.log({
                success: false,
                message: 'AWS Secret Access Key length is invalid',
                details: 'Should be exactly 40 characters'
            })
        } else {
            this.log({
                success: true,
                message: 'AWS Secret Access Key length is valid'
            })
        }
    }

    private validateNextAuthSecret(secret: string): void {
        if (secret.length < 32) {
            this.log({
                success: false,
                message: 'NEXTAUTH_SECRET is too short',
                details: 'Should be at least 32 characters for security'
            })
        } else {
            this.log({
                success: true,
                message: 'NEXTAUTH_SECRET length is adequate'
            })
        }
    }

    async validateDatabaseConnection(): Promise<void> {
        console.log(colors.blue('\n🗄️  Validating Database Connection...\n'))

        const prisma = new PrismaClient()

        try {
            // Test basic connection
            await prisma.$connect()
            this.log({
                success: true,
                message: 'Database connection successful'
            })

            // Test pgvector extension
            try {
                await prisma.$queryRaw`SELECT 1 as test`
                this.log({
                    success: true,
                    message: 'Database queries working'
                })
            } catch (error) {
                this.log({
                    success: false,
                    message: 'Database query test failed',
                    details: error instanceof Error ? error.message : String(error)
                })
            }

            // Check for pgvector extension
            try {
                const result = await prisma.$queryRaw`
          SELECT EXISTS(
            SELECT 1 FROM pg_extension WHERE extname = 'vector'
          ) as has_vector
        ` as [{ has_vector: boolean }]

                if (result[0]?.has_vector) {
                    this.log({
                        success: true,
                        message: 'pgvector extension is installed'
                    })
                } else {
                    this.log({
                        success: false,
                        message: 'pgvector extension is not installed',
                        details: 'Run: CREATE EXTENSION IF NOT EXISTS vector;'
                    })
                }
            } catch (error) {
                this.log({
                    success: false,
                    message: 'Could not check pgvector extension',
                    details: error instanceof Error ? error.message : String(error)
                })
            }

        } catch (error) {
            this.log({
                success: false,
                message: 'Database connection failed',
                details: error instanceof Error ? error.message : String(error)
            })
        } finally {
            await prisma.$disconnect()
        }
    }

    async validateAwsBedrock(): Promise<void> {
        console.log(colors.blue('\n🤖 Validating AWS Bedrock Connection...\n'))

        try {
            const client = new BedrockRuntimeClient({
                region: process.env.AWS_REGION || 'us-east-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                },
            })

            // Test with a minimal embedding request
            const testInput = {
                modelId: 'amazon.titan-embed-text-v1',
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    inputText: 'test'
                })
            }

            const command = new InvokeModelCommand(testInput)
            await client.send(command)

            this.log({
                success: true,
                message: 'AWS Bedrock connection successful',
                details: 'Titan embedding model is accessible'
            })

        } catch (error) {
            this.log({
                success: false,
                message: 'AWS Bedrock connection failed',
                details: error instanceof Error ? error.message : String(error)
            })
        }
    }

    async validateInngest(): Promise<void> {
        console.log(colors.blue('\n⚡ Validating Inngest Configuration...\n'))

        const eventKey = process.env.INNGEST_EVENT_KEY
        const signingKey = process.env.INNGEST_SIGNING_KEY

        if (!eventKey || !signingKey) {
            this.log({
                success: false,
                message: 'Inngest keys are missing'
            })
            return
        }

        // Basic format validation
        if (eventKey.length < 20) {
            this.log({
                success: false,
                message: 'Inngest event key appears too short'
            })
        } else {
            this.log({
                success: true,
                message: 'Inngest event key format looks valid'
            })
        }

        if (signingKey.length < 20) {
            this.log({
                success: false,
                message: 'Inngest signing key appears too short'
            })
        } else {
            this.log({
                success: true,
                message: 'Inngest signing key format looks valid'
            })
        }
    }

    async validateOptionalServices(): Promise<void> {
        console.log(colors.blue('\n🔧 Validating Optional Configuration...\n'))

        // Check optional environment variables
        const optionalVars = [
            'HEALTH_CHECK_API_KEY',
            'DEPLOYMENT_VERSION',
            'ALERT_WEBHOOK_URL',
            'RATE_LIMIT_REQUESTS_PER_MINUTE'
        ]

        optionalVars.forEach(varName => {
            const value = process.env[varName]
            if (value) {
                this.log({
                    success: true,
                    message: `Optional variable ${varName} is configured`
                })
            } else {
                this.log({
                    success: true,
                    message: `Optional variable ${varName} is not set (OK)`
                })
            }
        })

        // Validate numeric configurations
        const numericVars = [
            'MAX_CONCURRENT_JOBS',
            'EMBEDDING_BATCH_SIZE',
            'SCRAPING_TIMEOUT_MS'
        ]

        numericVars.forEach(varName => {
            const value = process.env[varName]
            if (value) {
                const num = parseInt(value, 10)
                if (isNaN(num) || num <= 0) {
                    this.log({
                        success: false,
                        message: `${varName} must be a positive number`,
                        details: `Current value: ${value}`
                    })
                } else {
                    this.log({
                        success: true,
                        message: `${varName} is valid: ${num}`
                    })
                }
            }
        })
    }

    printSummary(): void {
        console.log(colors.blue('\n📋 Validation Summary\n'))

        const successCount = this.results.filter(r => r.success).length
        const totalCount = this.results.length

        if (this.hasErrors) {
            console.log(colors.red(`❌ Validation failed: ${successCount}/${totalCount} checks passed`))
            console.log(colors.yellow('\nPlease fix the issues above before proceeding.'))
            process.exit(1)
        } else {
            console.log(colors.green(`✅ All validations passed: ${successCount}/${totalCount} checks successful`))
            console.log(colors.green('\nEnvironment is ready for deployment!'))
        }
    }
}

async function main() {
    console.log(colors.bold(colors.blue('🚀 Environment Validation Script\n')))

    const validator = new EnvironmentValidator()

    await validator.validateEnvironmentVariables()
    await validator.validateDatabaseConnection()
    await validator.validateAwsBedrock()
    await validator.validateInngest()
    await validator.validateOptionalServices()

    validator.printSummary()
}

// Run the validation
if (require.main === module) {
    main().catch(error => {
        console.error(colors.red('\n💥 Validation script failed:'), error)
        process.exit(1)
    })
}