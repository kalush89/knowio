/**
 * Verification script for NextAuth.js configuration
 * This script validates that all providers and adapters are properly configured
 */

import { nextAuthConfig } from '../auth'
import { getAvailableProviders } from './config'

// IMPROVEMENT: Define explicit interface for better type safety and reusability
interface NextAuthVerificationResults {
  adapters: {
    prisma: boolean
  }
  providers: {
    credentials: boolean
    google: boolean
    github: boolean
  }
  configuration: {
    session: boolean
    callbacks: boolean
    pages: boolean
    cookies: boolean
  }
  availableProviders: string[]
}

// IMPROVEMENT: Define supported provider types for better maintainability
type SupportedProviderId = 'credentials' | 'google' | 'github'

export function verifyNextAuthConfig(): NextAuthVerificationResults {
  const results: NextAuthVerificationResults = {
    adapters: {
      prisma: false
    },
    providers: {
      credentials: false,
      google: false,
      github: false
    },
    configuration: {
      session: false,
      callbacks: false,
      pages: false,
      cookies: false
    },
    availableProviders: []
  }

  // Check Prisma adapter
  results.adapters.prisma = !!nextAuthConfig.adapter

  // REFACTORED: Extract provider checking logic to follow SRP
  results.providers = checkProviders(nextAuthConfig.providers || [])

  // Check configuration sections
  results.configuration.session = !!nextAuthConfig.session
  results.configuration.callbacks = !!nextAuthConfig.callbacks
  results.configuration.pages = !!nextAuthConfig.pages
  results.configuration.cookies = !!nextAuthConfig.cookies

  // Get available providers based on environment
  results.availableProviders = getAvailableProviders()

  return results
}

// REFACTORED: Extract provider checking logic to follow SRP
function checkProviders(providers: any[]): NextAuthVerificationResults['providers'] {
  const providerResults: NextAuthVerificationResults['providers'] = {
    credentials: false,
    google: false,
    github: false
  }
  
  for (const provider of providers) {
    const providerId = getProviderId(provider)
    if (providerId && isSupportedProvider(providerId)) {
      providerResults[providerId] = true
    }
  }
  
  return providerResults
}

// REFACTORED: Extract provider ID extraction logic for better error handling
function getProviderId(provider: any): string | null {
  if (typeof provider === 'function') {
    try {
      const providerConfig = provider()
      return providerConfig?.id || null
    } catch (error) {
      // IMPROVEMENT: Handle provider function call errors gracefully
      console.warn('Failed to call provider function:', error)
      return null
    }
  } else if (typeof provider === 'object' && provider?.id) {
    return provider.id
  }
  return null
}

// IMPROVEMENT: Type-safe provider validation
function isSupportedProvider(providerId: string): providerId is SupportedProviderId {
  return ['credentials', 'google', 'github'].includes(providerId)
}

// ISSUE: Original function violated SRP by both getting results AND printing them
// REFACTORED: Split into separate functions for getting and printing results
export function printVerificationResults(): NextAuthVerificationResults {
  const results = verifyNextAuthConfig()
  printResults(results)
  return results
}

// REFACTORED: Extract printing logic to follow SRP
function printResults(results: NextAuthVerificationResults): void {
  console.log('NextAuth.js Configuration Verification')
  console.log('=====================================')
  
  printAdapterStatus(results.adapters)
  printProviderStatus(results.providers)
  printConfigurationStatus(results.configuration)
  printAvailableProviders(results.availableProviders)
  printOverallStatus(results)
}

// REFACTORED: Extract adapter status printing for better organization
function printAdapterStatus(adapters: NextAuthVerificationResults['adapters']): void {
  console.log('\nAdapters:')
  console.log(`  Prisma Adapter: ${adapters.prisma ? '✅' : '❌'}`)
}

// REFACTORED: Extract provider status printing for better organization
function printProviderStatus(providers: NextAuthVerificationResults['providers']): void {
  console.log('\nProviders:')
  console.log(`  Credentials: ${providers.credentials ? '✅' : '❌'}`)
  console.log(`  Google OAuth: ${providers.google ? '✅' : '❌'}`)
  console.log(`  GitHub OAuth: ${providers.github ? '✅' : '❌'}`)
}

// REFACTORED: Extract configuration status printing for better organization
function printConfigurationStatus(configuration: NextAuthVerificationResults['configuration']): void {
  console.log('\nConfiguration:')
  console.log(`  Session Config: ${configuration.session ? '✅' : '❌'}`)
  console.log(`  Callbacks: ${configuration.callbacks ? '✅' : '❌'}`)
  console.log(`  Pages: ${configuration.pages ? '✅' : '❌'}`)
  console.log(`  Cookies: ${configuration.cookies ? '✅' : '❌'}`)
}

// REFACTORED: Extract available providers printing for better organization
function printAvailableProviders(availableProviders: string[]): void {
  console.log('\nAvailable Providers (based on environment):')
  availableProviders.forEach(provider => {
    console.log(`  - ${provider}`)
  })
}

// REFACTORED: Extract overall status calculation and printing for better organization
function printOverallStatus(results: NextAuthVerificationResults): void {
  const criticalComponentsConfigured = isCriticalConfigurationComplete(results)
  const statusMessage = criticalComponentsConfigured 
    ? '✅ All critical components configured' 
    : '❌ Missing critical components'
  
  console.log(`\nOverall Status: ${statusMessage}`)
}

// REFACTORED: Extract critical configuration check logic for better maintainability
// IMPROVEMENT: Consider making critical components configurable instead of hardcoded
function isCriticalConfigurationComplete(results: NextAuthVerificationResults): boolean {
  return results.adapters.prisma && 
         results.providers.credentials && 
         results.configuration.session &&
         results.configuration.callbacks
}

// Run verification if this file is executed directly
if (require.main === module) {
  printVerificationResults()
}