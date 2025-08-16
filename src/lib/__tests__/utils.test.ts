import { describe, it, expect } from 'vitest'
import {
  estimateTokenCount,
  preprocessText,
  sanitizeContent,
  splitIntoSentences,
  truncateToTokenLimit,
  extractTextFromHtml,
  validateTextQuality
} from '../utils'

describe('estimateTokenCount', () => {
  it('should return 0 for empty text', () => {
    expect(estimateTokenCount('')).toBe(0)
    expect(estimateTokenCount('   ')).toBe(0)
  })

  it('should estimate tokens for simple text', () => {
    expect(estimateTokenCount('hello world')).toBe(2)
    expect(estimateTokenCount('The quick brown fox')).toBe(4)
  })

  it('should account for punctuation', () => {
    expect(estimateTokenCount('Hello, world!')).toBe(3) // hello, world, punctuation
    expect(estimateTokenCount('What is this? It is a test.')).toBe(8) // Adjusted expectation
  })

  it('should handle complex text with multiple punctuation', () => {
    const text = 'This is a test: it includes punctuation, numbers (123), and symbols!'
    const count = estimateTokenCount(text)
    expect(count).toBeGreaterThan(10)
    expect(count).toBeLessThan(20)
  })
})

describe('preprocessText', () => {
  it('should normalize whitespace', () => {
    expect(preprocessText('hello    world')).toBe('hello world')
    expect(preprocessText('hello\t\tworld')).toBe('hello world')
  })

  it('should remove excessive line breaks', () => {
    expect(preprocessText('line1\n\n\n\nline2')).toBe('line1\n\nline2')
  })

  it('should clean HTML entities', () => {
    expect(preprocessText('hello&nbsp;world')).toBe('hello world')
    expect(preprocessText('&lt;tag&gt;')).toBe('<tag>')
    expect(preprocessText('&quot;quoted&quot;')).toBe('"quoted"')
  })

  it('should remove zero-width characters', () => {
    expect(preprocessText('hello\u200Bworld')).toBe('helloworld')
  })

  it('should trim and normalize', () => {
    expect(preprocessText('  hello world  ')).toBe('hello world')
  })
})

describe('sanitizeContent', () => {
  it('should remove script tags', () => {
    const html = 'Hello <script>alert("bad")</script> world'
    expect(sanitizeContent(html)).toBe('Hello world')
  })

  it('should remove style tags', () => {
    const html = 'Hello <style>body{color:red}</style> world'
    expect(sanitizeContent(html)).toBe('Hello world')
  })

  it('should remove HTML comments', () => {
    const html = 'Hello <!-- comment --> world'
    expect(sanitizeContent(html)).toBe('Hello world')
  })

  it('should remove all HTML tags', () => {
    const html = '<div>Hello <span>world</span></div>'
    expect(sanitizeContent(html)).toBe('Hello world')
  })

  it('should handle complex HTML', () => {
    const html = `
      <div class="content">
        <script>alert('bad')</script>
        <h1>Title</h1>
        <p>This is a <strong>test</strong> paragraph.</p>
        <!-- comment -->
        <style>.test{color:red}</style>
      </div>
    `
    const result = sanitizeContent(html)
    expect(result).toContain('Title')
    expect(result).toContain('This is a test paragraph.')
    expect(result).not.toContain('<')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('comment')
  })
})

describe('splitIntoSentences', () => {
  it('should split on periods', () => {
    const text = 'First sentence. Second sentence.'
    const sentences = splitIntoSentences(text)
    expect(sentences).toEqual(['First sentence.', 'Second sentence.'])
  })

  it('should split on exclamation marks', () => {
    const text = 'Hello! How are you?'
    const sentences = splitIntoSentences(text)
    expect(sentences).toEqual(['Hello!', 'How are you?'])
  })

  it('should handle multiple punctuation', () => {
    const text = 'What?! Really... Yes!'
    const sentences = splitIntoSentences(text)
    expect(sentences.length).toBeGreaterThan(0)
  })

  it('should filter empty sentences', () => {
    const text = 'Hello.. World.'
    const sentences = splitIntoSentences(text)
    expect(sentences.every(s => s.trim().length > 0)).toBe(true)
  })
})

describe('truncateToTokenLimit', () => {
  it('should return original text if under limit', () => {
    const text = 'short text'
    expect(truncateToTokenLimit(text, 10)).toBe(text)
  })

  it('should truncate text that exceeds limit', () => {
    const text = 'this is a very long text that should be truncated'
    const result = truncateToTokenLimit(text, 5)
    expect(estimateTokenCount(result)).toBeLessThanOrEqual(5)
    expect(result.length).toBeLessThan(text.length)
  })

  it('should preserve word boundaries', () => {
    const text = 'word1 word2 word3 word4'
    const result = truncateToTokenLimit(text, 2)
    expect(result).not.toContain('word3')
    expect(result.split(' ').every(word => word.length > 0)).toBe(true)
  })
})

describe('extractTextFromHtml', () => {
  it('should convert block elements to line breaks', () => {
    const html = '<div>Line 1</div><div>Line 2</div>'
    const result = extractTextFromHtml(html)
    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
  })

  it('should handle lists', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>'
    const result = extractTextFromHtml(html)
    expect(result).toContain('Item 1')
    expect(result).toContain('Item 2')
  })

  it('should remove scripts and styles', () => {
    const html = `
      <div>
        <script>alert('bad')</script>
        <p>Good content</p>
        <style>body{color:red}</style>
      </div>
    `
    const result = extractTextFromHtml(html)
    expect(result).toContain('Good content')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('color:red')
  })
})

describe('validateTextQuality', () => {
  it('should validate good quality text', () => {
    const text = 'This is a well-written paragraph with sufficient content and variety.'
    const result = validateTextQuality(text)
    expect(result.isValid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('should reject text that is too short', () => {
    const result = validateTextQuality('short')
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain('Text is too short (minimum 10 characters)')
  })

  it('should reject text that is too long', () => {
    const longText = 'a'.repeat(100001)
    const result = validateTextQuality(longText)
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain('Text is too long (maximum 100,000 characters)')
  })

  it('should reject text with too few words', () => {
    const result = validateTextQuality('one two')
    expect(result.isValid).toBe(false)
    expect(result.issues).toContain('Text has too few words (minimum 3 words)')
  })

  it('should detect excessive repetition', () => {
    const repetitiveText = 'word word word word word word word word word word word word word word word word word word word word word'
    const result = validateTextQuality(repetitiveText)
    expect(result.isValid).toBe(false)
    expect(result.issues.some(issue => issue.includes('repetition'))).toBe(true)
  })

  it('should detect too many non-alphanumeric characters', () => {
    const symbolText = '!@#$%^&*()_+{}|:"<>?[]\\;\',./'
    const result = validateTextQuality(symbolText)
    expect(result.isValid).toBe(false)
    expect(result.issues.some(issue => issue.includes('non-alphanumeric'))).toBe(true)
  })
})