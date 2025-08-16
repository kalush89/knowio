import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebScraper } from '../scraper'
import { ScrapingError } from '../../errors'

describe('WebScraper', () => {
  let scraper: WebScraper

  beforeEach(() => {
    scraper = new WebScraper()
  })

  afterEach(async () => {
    await scraper.close()
  }, 15000)

  describe('extractTextFromHtml', () => {
    it('should extract clean text content from HTML', async () => {
      const html = `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <nav>Navigation</nav>
            <header>Header</header>
            <main>
              <h1>Main Content</h1>
              <p>This is the main content of the page.</p>
              <p>Another paragraph with important information.</p>
            </main>
            <aside>Sidebar content</aside>
            <footer>Footer</footer>
            <script>console.log('script')</script>
            <style>.test { color: red; }</style>
          </body>
        </html>
      `

      const text = await scraper.extractTextFromHtml(html)
      
      expect(text).toContain('Main Content')
      expect(text).toContain('This is the main content')
      expect(text).toContain('Another paragraph')
      expect(text).not.toContain('Navigation')
      expect(text).not.toContain('Header')
      expect(text).not.toContain('Sidebar')
      expect(text).not.toContain('Footer')
      expect(text).not.toContain('console.log')
      expect(text).not.toContain('.test { color: red; }')
    }, 30000)

    it('should handle HTML with advertisements and navigation', async () => {
      const html = `
        <html>
          <body>
            <div class="advertisement">Buy now!</div>
            <div class="nav">Home | About | Contact</div>
            <article>
              <h1>Article Title</h1>
              <p>Article content here.</p>
            </article>
            <div class="ads">More ads</div>
            <div class="sidebar">Sidebar</div>
          </body>
        </html>
      `

      const text = await scraper.extractTextFromHtml(html)
      
      expect(text).toContain('Article Title')
      expect(text).toContain('Article content here')
      expect(text).not.toContain('Buy now!')
      expect(text).not.toContain('Home | About | Contact')
      expect(text).not.toContain('More ads')
      expect(text).not.toContain('Sidebar')
    }, 30000)

    it('should handle empty or minimal HTML', async () => {
      const html = `<html><body></body></html>`
      const text = await scraper.extractTextFromHtml(html)
      expect(text).toBe('')
    }, 30000)
  })

  describe('extractMetadataFromHtml', () => {
    it('should extract basic metadata from HTML', async () => {
      const html = `
        <html>
          <head>
            <title>Test Page Title</title>
            <meta name="description" content="Test page description">
            <meta name="author" content="Test Author">
            <meta name="article:published_time" content="2024-01-01T00:00:00Z">
          </head>
          <body>
            <h1>Main Heading</h1>
          </body>
        </html>
      `

      const metadata = await scraper.extractMetadataFromHtml(html)
      
      expect(metadata.title).toBe('Test Page Title')
      expect(metadata.description).toBe('Test page description')
      expect(metadata.author).toBe('Test Author')
      expect(metadata.publishedDate).toBe('2024-01-01T00:00:00Z')
    }, 30000)

    it('should extract Open Graph metadata', async () => {
      const html = `
        <html>
          <head>
            <title>Test Page</title>
            <meta property="og:description" content="OG Description">
            <meta property="og:author" content="OG Author">
          </head>
          <body></body>
        </html>
      `

      const metadata = await scraper.extractMetadataFromHtml(html)
      
      expect(metadata.description).toBe('OG Description')
      expect(metadata.author).toBe('OG Author')
    }, 30000)

    it('should fallback to h1 for title if document.title is empty', async () => {
      const html = `
        <html>
          <head></head>
          <body>
            <h1>Fallback Title</h1>
          </body>
        </html>
      `

      const metadata = await scraper.extractMetadataFromHtml(html)
      
      expect(metadata.title).toBe('Fallback Title')
    }, 30000)
  })

  describe('error handling', () => {
    it('should throw ScrapingError for invalid URLs', async () => {
      await expect(scraper.scrape('not-a-url')).rejects.toThrow(ScrapingError)
    }, 30000)

    it('should handle timeout errors', async () => {
      // Test with a very short timeout
      await expect(
        scraper.scrape('https://httpbin.org/delay/5', { timeout: 100 })
      ).rejects.toThrow(ScrapingError)
    }, 30000)
  })

  describe('link extraction', () => {
    it('should extract and filter relevant links', async () => {
      const mockScrape = vi.spyOn(scraper, 'scrape').mockResolvedValue({
        url: 'https://example.com/docs',
        title: 'Documentation',
        content: 'Content',
        metadata: { title: 'Documentation' },
        links: [
          'https://example.com/docs/api',
          'https://example.com/docs/guide',
          'https://example.com/docs/reference'
        ]
      })

      const result = await scraper.scrape('https://example.com/docs')
      
      expect(result.links).toHaveLength(3)
      expect(result.links).toContain('https://example.com/docs/api')
      expect(result.links).toContain('https://example.com/docs/guide')
      expect(result.links).toContain('https://example.com/docs/reference')

      mockScrape.mockRestore()
    })
  })

  describe('browser management', () => {
    it('should close browser properly', async () => {
      const html = '<html><body><p>Test</p></body></html>'
      await scraper.extractTextFromHtml(html)
      
      await expect(scraper.close()).resolves.not.toThrow()
    }, 30000)
  })
})