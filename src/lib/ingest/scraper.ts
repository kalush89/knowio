import { chromium, Browser, Page } from 'playwright'
import { ScrapedContent, ScrapingOptions, PageMetadata } from '../types'
import { ScrapingError, ErrorContext, ErrorSeverity } from '../errors'
import { defaultErrorHandler } from '../error-handler'
import { loggers } from '../logger'

export class WebScraper {
  private browser: Browser | null = null
  private readonly logger = loggers.scraper

  /**
   * Initialize the browser instance
   */
  private async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-default-apps',
            '--disable-extensions'
          ],
        })
      } catch (error) {
        throw new ScrapingError(
          'Failed to initialize browser',
          false,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
    return this.browser
  }

  /**
   * Scrape content from a URL with comprehensive error handling
   */
  async scrape(url: string, options: ScrapingOptions = {}): Promise<ScrapedContent> {
    const context: ErrorContext = {
      component: 'WebScraper',
      operation: 'scrape',
      url,
      timestamp: new Date(),
      metadata: { timeout: options.timeout || 30000 }
    }

    this.logger.info('Starting web scraping', { url, options }, context)

    return await defaultErrorHandler.executeWithRetry(
      async () => {
        const browser = await this.initBrowser()
        const timeout = options.timeout || 30000

        // Create context with user agent and other settings
        const browserContext = await browser.newContext({
          userAgent: options.userAgent || 'Mozilla/5.0 (compatible; DocumentIngestionBot/1.0)',
          viewport: { width: 1280, height: 720 },
          ignoreHTTPSErrors: true,
        })

        const page = await browserContext.newPage()

        try {
          // Set up request interception to block unnecessary resources
          await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType()
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
              route.abort()
            } else {
              route.continue()
            }
          })

          // Navigate to the page with error handling
          const response = await this.navigateToPage(page, url, timeout, context)

          // Wait for specific selector if provided
          if (options.waitForSelector) {
            await this.waitForSelector(page, options.waitForSelector, timeout, context)
          }

          // Wait a bit for dynamic content to load
          await page.waitForTimeout(1000)

          // Extract content and metadata
          const content = await this.extractText(page)
          const metadata = await this.extractMetadata(page)
          const links = await this.extractLinks(page, url)

          // Validate extracted content
          if (!content.trim()) {
            throw new ScrapingError(
              `No content extracted from URL: ${url}`,
              false,
              ErrorSeverity.MEDIUM,
              context
            )
          }

          this.logger.info('Web scraping completed successfully', {
            url,
            contentLength: content.length,
            linksFound: links.length,
            title: metadata.title
          }, context)

          return {
            url,
            title: metadata.title,
            content,
            metadata,
            links,
          }
        } finally {
          await page.close()
          await browserContext.close()
        }
      },
      context
    )
  }

  /**
   * Navigate to page with proper error handling
   */
  private async navigateToPage(page: Page, url: string, timeout: number, context: ErrorContext): Promise<void> {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      })

      if (!response) {
        throw new ScrapingError(
          `No response received for URL: ${url}`,
          true,
          ErrorSeverity.MEDIUM,
          context
        )
      }

      const status = response.status()
      if (status >= 400) {
        const retryable = status >= 500 || status === 429 || status === 408
        const severity = status >= 500 ? ErrorSeverity.MEDIUM : ErrorSeverity.LOW
        
        throw new ScrapingError(
          `HTTP ${status} error for URL: ${url}`,
          retryable,
          severity,
          context
        )
      }

      // Check for access restrictions
      if (status === 403 || status === 401) {
        throw new ScrapingError(
          `Access denied for URL: ${url} (HTTP ${status})`,
          false,
          ErrorSeverity.LOW,
          context
        )
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ScrapingError(
          `Timeout while loading URL: ${url}`,
          true,
          ErrorSeverity.MEDIUM,
          context,
          error
        )
      }
      if (error instanceof ScrapingError) {
        throw error
      }
      throw new ScrapingError(
        `Failed to load URL: ${url}`,
        true,
        ErrorSeverity.MEDIUM,
        context,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Wait for selector with error handling
   */
  private async waitForSelector(page: Page, selector: string, timeout: number, context: ErrorContext): Promise<void> {
    try {
      await page.waitForSelector(selector, { timeout })
    } catch (error) {
      throw new ScrapingError(
        `Selector "${selector}" not found within timeout`,
        true,
        ErrorSeverity.LOW,
        context,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Extract text content from the page with advanced filtering
   */
  private async extractText(page: Page): Promise<string> {
    return await page.evaluate(() => {
      // Remove unwanted elements (scripts, styles, navigation, ads, etc.)
      const unwantedSelectors = [
        'script', 'style', 'noscript',
        'nav', 'header', 'footer', 'aside',
        '.nav', '.navigation', '.menu', '.sidebar',
        '.header', '.footer', '.banner', '.advertisement',
        '.ads', '.ad', '.promo', '.promotion',
        '.social', '.share', '.sharing',
        '.comments', '.comment-section',
        '.breadcrumb', '.breadcrumbs',
        '.pagination', '.pager',
        '.related', '.recommended',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '[class*="nav"]', '[class*="menu"]', '[class*="sidebar"]',
        '[class*="ad"]', '[class*="advertisement"]',
        '[id*="nav"]', '[id*="menu"]', '[id*="sidebar"]',
        '[id*="ad"]', '[id*="advertisement"]'
      ]

      unwantedSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector)
        elements.forEach(el => el.remove())
      })

      // Try to find main content area with priority order
      const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.main-content',
        '.content',
        '#content',
        '.post-content',
        '.entry-content',
        '.article-content',
        '.documentation',
        '.docs',
        '.api-docs'
      ]

      let mainContent: Element | null = null
      for (const selector of contentSelectors) {
        mainContent = document.querySelector(selector)
        if (mainContent) break
      }

      // Fallback to body if no main content found
      if (!mainContent) {
        mainContent = document.body
      }

      if (!mainContent) {
        return ''
      }

      // Clean up the content further
      const clone = mainContent.cloneNode(true) as Element

      // Remove any remaining unwanted elements from the clone
      const additionalUnwanted = clone.querySelectorAll(
        'button, input, select, textarea, form, iframe, embed, object, video, audio'
      )
      additionalUnwanted.forEach(el => el.remove())

      // Get text content and clean it up
      let text = (clone as HTMLElement).innerText || ''

      // Clean up whitespace and formatting
      text = text
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n\s*\n/g, '\n') // Replace multiple newlines with single newline
        .trim()

      return text
    })
  }

  /**
   * Extract comprehensive metadata from the page including structure information
   */
  private async extractMetadata(page: Page): Promise<PageMetadata> {
    return await page.evaluate(() => {
      const getMetaContent = (name: string): string | undefined => {
        const selectors = [
          `meta[name="${name}"]`,
          `meta[property="${name}"]`,
          `meta[name="${name.toLowerCase()}"]`,
          `meta[property="${name.toLowerCase()}"]`,
          `meta[name="og:${name}"]`,
          `meta[property="og:${name}"]`,
          `meta[name="twitter:${name}"]`,
          `meta[property="twitter:${name}"]`
        ]

        for (const selector of selectors) {
          const meta = document.querySelector(selector)
          const content = meta?.getAttribute('content')
          if (content) return content
        }
        return undefined
      }

      // Extract title with fallbacks
      let title = document.title || ''
      if (!title) {
        const h1 = document.querySelector('h1')
        title = h1?.textContent?.trim() || ''
      }

      // Extract section information from URL path or headings
      let section: string | undefined
      const path = window.location.pathname
      const pathParts = path.split('/').filter(Boolean)
      if (pathParts.length > 0) {
        section = pathParts[pathParts.length - 1]
          .replace(/[-_]/g, ' ')
          .replace(/\.(html?|php|aspx?)$/i, '')
      }

      // Try to get section from main heading structure
      if (!section) {
        const mainHeading = document.querySelector('h1, h2')
        if (mainHeading) {
          section = mainHeading.textContent?.trim()
        }
      }

      return {
        title: title.trim(),
        description: getMetaContent('description') ||
          getMetaContent('og:description') ||
          getMetaContent('twitter:description'),
        author: getMetaContent('author') ||
          getMetaContent('article:author') ||
          getMetaContent('og:author'),
        publishedDate: getMetaContent('article:published_time') ||
          getMetaContent('date') ||
          getMetaContent('published') ||
          getMetaContent('article:published') ||
          getMetaContent('og:published_time'),
        section: section
      }
    })
  }

  /**
   * Extract relevant links from the page with filtering
   */
  private async extractLinks(page: Page, baseUrl: string): Promise<string[]> {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'))
      return anchors
        .map(a => {
          const anchor = a as HTMLAnchorElement
          return {
            href: anchor.href,
            text: anchor.textContent?.trim() || '',
            className: anchor.className || '',
            id: anchor.id || ''
          }
        })
        .filter(link => link.href && link.href !== '#')
    })

    // Filter and normalize links
    const base = new URL(baseUrl)
    const filteredLinks = links
      .filter(link => {
        try {
          const url = new URL(link.href)

          // Only include links from the same domain
          if (url.hostname !== base.hostname) return false

          // Only include HTTP/HTTPS links
          if (!url.protocol.startsWith('http')) return false

          // Exclude common non-content links
          const excludePatterns = [
            /\.(css|js|json|xml|pdf|zip|tar|gz|exe|dmg)$/i,
            /#$/,
            /javascript:/i,
            /mailto:/i,
            /tel:/i
          ]

          if (excludePatterns.some(pattern => pattern.test(link.href))) {
            return false
          }

          // Exclude links with navigation-related classes or text
          const navKeywords = ['nav', 'menu', 'breadcrumb', 'pagination', 'footer', 'header']
          const hasNavClass = navKeywords.some(keyword =>
            link.className.toLowerCase().includes(keyword) ||
            link.id.toLowerCase().includes(keyword)
          )

          if (hasNavClass) return false

          return true
        } catch {
          return false
        }
      })
      .map(link => link.href)
      .filter((href, index, array) => array.indexOf(href) === index) // Remove duplicates
      .slice(0, 50) // Limit to first 50 relevant links

    return filteredLinks
  }

  /**
   * Extract text content from HTML string (useful for testing)
   */
  async extractTextFromHtml(html: string): Promise<string> {
    const browser = await this.initBrowser()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.setContent(html)
      return await this.extractText(page)
    } finally {
      await page.close()
      await context.close()
    }
  }

  /**
   * Extract metadata from HTML string (useful for testing)
   */
  async extractMetadataFromHtml(html: string): Promise<PageMetadata> {
    const browser = await this.initBrowser()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.setContent(html)
      return await this.extractMetadata(page)
    } finally {
      await page.close()
      await context.close()
    }
  }

  /**
   * Close the browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}