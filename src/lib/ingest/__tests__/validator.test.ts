import { describe, it, expect, vi, beforeEach } from 'vitest'
import { URLValidator, ingestionOptionsSchema } from '../validator'

// Mock fetch for testing
global.fetch = vi.fn()

describe('URLValidator', () => {
  let validator: URLValidator

  beforeEach(() => {
    validator = new URLValidator()
    vi.clearAllMocks()
  })

  describe('validate', () => {
    it('should validate a proper HTTPS URL', async () => {
      // Mock successful fetch
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result = await validator.validate('https://example.com/docs')
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.sanitizedUrl).toBe('https://example.com/docs')
    })

    it('should validate a proper HTTP URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result = await validator.validate('http://example.com/docs')
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject invalid URL format', async () => {
      const result = await validator.validate('not-a-url')
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Invalid URL format')
    })

    it('should reject unsupported protocols', async () => {
      const result = await validator.validate('ftp://example.com')
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Only HTTP and HTTPS protocols are supported')
    })

    it('should reject localhost in production', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const result = await validator.validate('http://localhost:3000')
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Private and local URLs are not allowed in production')

      process.env.NODE_ENV = originalEnv
    })

    it('should reject private IP addresses in production', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const privateIPs = [
        'http://192.168.1.1',
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://127.0.0.1'
      ]

      for (const ip of privateIPs) {
        const result = await validator.validate(ip)
        expect(result.isValid).toBe(false)
        expect(result.errors).toContain('Private and local URLs are not allowed in production')
      }

      process.env.NODE_ENV = originalEnv
    })

    it('should allow localhost in development', async () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result = await validator.validate('http://localhost:3000')
      
      expect(result.isValid).toBe(true)

      process.env.NODE_ENV = originalEnv
    })

    it('should reject inaccessible URLs', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      const result = await validator.validate('https://nonexistent.example.com')
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('URL is not accessible or returns an error')
    })

    it('should handle URLs that return error status', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)

      const result = await validator.validate('https://example.com/404')
      
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('URL is not accessible or returns an error')
    })
  })

  describe('sanitize', () => {
    it('should remove URL fragments', () => {
      const result = validator.sanitize('https://example.com/docs#section')
      expect(result).toBe('https://example.com/docs')
    })

    it('should normalize trailing slash for root path', () => {
      const result = validator.sanitize('https://example.com/')
      expect(result).toBe('https://example.com')
    })

    it('should preserve non-root paths with trailing slash', () => {
      const result = validator.sanitize('https://example.com/docs/')
      expect(result).toBe('https://example.com/docs/')
    })

    it('should handle malformed URLs gracefully', () => {
      const result = validator.sanitize('not-a-url')
      expect(result).toBe('not-a-url')
    })
  })

  describe('checkAccessibility', () => {
    it('should return true for accessible URLs', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      const result = await validator.checkAccessibility('https://example.com')
      expect(result).toBe(true)
    })

    it('should try GET request if HEAD fails', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('HEAD failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)

      const result = await validator.checkAccessibility('https://example.com')
      expect(result).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('should accept partial content response', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('HEAD failed'))
        .mockResolvedValueOnce({
          ok: false,
          status: 206, // Partial content
        } as Response)

      const result = await validator.checkAccessibility('https://example.com')
      expect(result).toBe(true)
    })

    it('should return false if both requests fail', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('HEAD failed'))
        .mockRejectedValueOnce(new Error('GET failed'))

      const result = await validator.checkAccessibility('https://example.com')
      expect(result).toBe(false)
    })

    it('should use correct headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      await validator.checkAccessibility('https://example.com')
      
      expect(fetch).toHaveBeenCalledWith('https://example.com', {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Knowio-Bot/1.0 (+https://knowio.dev/bot)',
        },
        signal: expect.any(AbortSignal),
      })
    })
  })
})

describe('ingestionOptionsSchema', () => {
  it('should validate valid options', () => {
    const validOptions = {
      maxDepth: 3,
      followLinks: true,
      respectRobots: false,
    }

    const result = ingestionOptionsSchema.parse(validOptions)
    expect(result).toEqual(validOptions)
  })

  it('should apply default values', () => {
    const result = ingestionOptionsSchema.parse({})
    expect(result).toEqual({
      maxDepth: 3,
      followLinks: false,
      respectRobots: true,
    })
  })

  it('should reject invalid maxDepth', () => {
    expect(() => {
      ingestionOptionsSchema.parse({ maxDepth: 0 })
    }).toThrow()

    expect(() => {
      ingestionOptionsSchema.parse({ maxDepth: 11 })
    }).toThrow()
  })

  it('should accept partial options', () => {
    const result = ingestionOptionsSchema.parse({ maxDepth: 5 })
    expect(result.maxDepth).toBe(5)
    expect(result.followLinks).toBe(false) // default
    expect(result.respectRobots).toBe(true) // default
  })
})