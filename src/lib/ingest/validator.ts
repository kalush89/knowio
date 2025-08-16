import { z } from 'zod'
import { ValidationResult } from '../types'

// URL validation schema
const urlSchema = z.string().url()

// Options validation schema
export const ingestionOptionsSchema = z.object({
  maxDepth: z.number().min(1).max(10).optional().default(3),
  followLinks: z.boolean().optional().default(false),
  respectRobots: z.boolean().optional().default(true),
})

export class URLValidator {
  /**
   * Validates and sanitizes a URL
   */
  async validate(url: string): Promise<ValidationResult> {
    const errors: string[] = []
    
    try {
      // Basic URL format validation
      urlSchema.parse(url)
      
      // Additional URL checks
      const urlObj = new URL(url)
      
      // Check for supported protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        errors.push('Only HTTP and HTTPS protocols are supported')
      }
      
      // Check for localhost or private IPs in production
      if (process.env.NODE_ENV === 'production') {
        const hostname = urlObj.hostname.toLowerCase()
        if (hostname === 'localhost' || 
            hostname.startsWith('127.') || 
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
          errors.push('Private and local URLs are not allowed in production')
        }
      }
      
      const sanitizedUrl = this.sanitize(url)
      
      // Check accessibility
      const isAccessible = await this.checkAccessibility(sanitizedUrl)
      if (!isAccessible) {
        errors.push('URL is not accessible or returns an error')
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        sanitizedUrl: errors.length === 0 ? sanitizedUrl : undefined,
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        errors.push('Invalid URL format')
      } else {
        errors.push('URL validation failed')
      }
      
      return {
        isValid: false,
        errors,
      }
    }
  }

  /**
   * Sanitizes a URL by removing fragments and normalizing
   */
  sanitize(url: string): string {
    try {
      const urlObj = new URL(url)
      // Remove fragment
      urlObj.hash = ''
      // Normalize trailing slash for root path only
      if (urlObj.pathname === '/' && !urlObj.search) {
        return `${urlObj.protocol}//${urlObj.host}`
      }
      return urlObj.toString()
    } catch {
      return url
    }
  }

  /**
   * Checks if a URL is accessible
   */
  async checkAccessibility(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Knowio-Bot/1.0 (+https://knowio.dev/bot)',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })
      
      return response.ok
    } catch {
      // If HEAD fails, try GET with a small range
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Knowio-Bot/1.0 (+https://knowio.dev/bot)',
            'Range': 'bytes=0-1023', // Only fetch first 1KB
          },
          signal: AbortSignal.timeout(10000),
        })
        
        return response.ok || response.status === 206 // Accept partial content
      } catch {
        return false
      }
    }
  }
}