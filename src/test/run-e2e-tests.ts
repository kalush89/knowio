#!/usr/bin/env node

/**
 * End-to-End Integration Test Runner
 * 
 * This script runs the comprehensive end-to-end integration tests for the document ingestion system.
 * It includes setup, execution, and cleanup phases to ensure tests run in isolation.
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

class E2ETestRunner {
  private static readonly TEST_FILES = [
    'src/test/e2e-integration.test.ts',
    'src/test/real-docs-integration.test.ts',
    'src/test/performance-integration.test.ts'
  ]

  private static readonly REQUIRED_ENV_VARS = [
    'DATABASE_URL'
  ]

  static async run() {
    console.log('🚀 Starting End-to-End Integration Tests')
    console.log('=' .repeat(50))

    try {
      // Pre-flight checks
      this.performPreflightChecks()

      // Setup test environment
      await this.setupTestEnvironment()

      // Run tests
      await this.runTests()

      console.log('\n✅ All End-to-End Integration Tests Passed!')
      console.log('=' .repeat(50))

    } catch (error) {
      console.error('\n❌ End-to-End Integration Tests Failed!')
      console.error('Error:', error)
      process.exit(1)
    }
  }

  private static performPreflightChecks() {
    console.log('🔍 Performing pre-flight checks...')

    // Check if test files exist
    for (const testFile of this.TEST_FILES) {
      if (!existsSync(resolve(testFile))) {
        throw new Error(`Test file not found: ${testFile}`)
      }
    }

    // Check environment variables
    for (const envVar of this.REQUIRED_ENV_VARS) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable not set: ${envVar}`)
      }
    }

    // Ensure we're using a test database
    const dbUrl = process.env.DATABASE_URL
    if (dbUrl && !dbUrl.includes('test')) {
      console.warn('⚠️  Warning: DATABASE_URL does not contain "test". Ensure you are using a test database.')
    }

    console.log('✅ Pre-flight checks passed')
  }

  private static async setupTestEnvironment() {
    console.log('🛠️  Setting up test environment...')

    try {
      // Generate Prisma client
      console.log('  📦 Generating Prisma client...')
      execSync('npx prisma generate', { stdio: 'pipe' })

      // Push database schema (for test database)
      console.log('  🗄️  Setting up test database schema...')
      execSync('npx prisma db push --force-reset', { stdio: 'pipe' })

      console.log('✅ Test environment setup complete')
    } catch (error) {
      throw new Error(`Failed to setup test environment: ${error}`)
    }
  }

  private static async runTests() {
    console.log('🧪 Running End-to-End Integration Tests...')
    console.log('')

    for (const testFile of this.TEST_FILES) {
      console.log(`📋 Running: ${testFile}`)
      
      try {
        const startTime = Date.now()
        
        // Run individual test file
        execSync(`npx vitest run ${testFile} --reporter=verbose`, { 
          stdio: 'inherit',
          env: {
            ...process.env,
            NODE_ENV: 'test'
          }
        })
        
        const duration = Date.now() - startTime
        console.log(`✅ ${testFile} completed in ${duration}ms`)
        console.log('')
        
      } catch (error) {
        throw new Error(`Test file failed: ${testFile}`)
      }
    }
  }
}

// Run the tests if this script is executed directly
if (require.main === module) {
  E2ETestRunner.run().catch(error => {
    console.error('Test runner failed:', error)
    process.exit(1)
  })
}

export { E2ETestRunner }