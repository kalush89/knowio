/**
 * Utility functions for text processing and token counting
 */

/**
 * Estimates token count for text using a simple approximation
 * This is a rough estimate - for production use, consider using tiktoken or similar
 */
export function estimateTokenCount(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English text
  // This accounts for spaces, punctuation, and common patterns
  const cleanText = text.trim()
  if (!cleanText) return 0
  
  // Split by whitespace and count words, then add punctuation tokens
  const words = cleanText.split(/\s+/).length
  const punctuation = (cleanText.match(/[.,!?;:()[\]{}"'-]/g) || []).length
  
  // Rough formula: words + punctuation/2 (since some punctuation is part of words)
  return Math.ceil(words + punctuation / 2)
}

/**
 * Preprocesses text by cleaning and normalizing it
 */
export function preprocessText(text: string): string {
  return text
    // Clean up common HTML entities that might have been missed
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Remove zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Remove excessive line breaks (but preserve double line breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Normalize other whitespace but preserve line breaks
    .replace(/[ \t]+/g, ' ')
    // Trim and ensure clean formatting
    .trim()
}

/**
 * Sanitizes text content by removing potentially harmful or unwanted content
 */
export function sanitizeContent(text: string): string {
  const cleanedText = text
    // Remove script tags and their content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove style tags and their content
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove remaining HTML tags
    .replace(/<[^>]*>/g, '')
  
  // Apply preprocessing
  return preprocessText(cleanedText)
}

/**
 * Splits text into sentences while preserving context
 */
export function splitIntoSentences(text: string): string[] {
  // Simple sentence splitting - can be enhanced with more sophisticated NLP
  const sentences: string[] = []
  const parts = text.split(/([.!?]+)/)
  
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i]?.trim()
    const punctuation = parts[i + 1] || '.'
    
    if (sentence && sentence.length > 0) {
      sentences.push(sentence + punctuation)
    }
  }
  
  return sentences.filter(sentence => sentence.length > 1)
}

/**
 * Truncates text to a maximum token count while preserving word boundaries
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  if (estimateTokenCount(text) <= maxTokens) {
    return text
  }
  
  const words = text.split(/\s+/)
  let result = ''
  let tokenCount = 0
  
  for (const word of words) {
    const wordTokens = estimateTokenCount(word)
    if (tokenCount + wordTokens > maxTokens) {
      break
    }
    result += (result ? ' ' : '') + word
    tokenCount += wordTokens
  }
  
  return result
}

/**
 * Extracts meaningful text from HTML while preserving structure
 */
export function extractTextFromHtml(html: string): string {
  // Remove script and style elements
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
  
  // Convert common block elements to line breaks
  text = text
    .replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<\/?(ul|ol|table)[^>]*>/gi, '\n\n')
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, ' ')
  
  // Clean up the text
  return sanitizeContent(text)
}

/**
 * Validates that text content meets minimum quality requirements
 */
export function validateTextQuality(text: string): {
  isValid: boolean
  issues: string[]
} {
  const issues: string[] = []
  const cleanText = text.trim()
  
  if (cleanText.length < 10) {
    issues.push('Text is too short (minimum 10 characters)')
  }
  
  if (cleanText.length > 100000) {
    issues.push('Text is too long (maximum 100,000 characters)')
  }
  
  // Check for reasonable word count
  const wordCount = cleanText.split(/\s+/).length
  if (wordCount < 3) {
    issues.push('Text has too few words (minimum 3 words)')
  }
  
  // Check for excessive repetition
  const words = cleanText.toLowerCase().split(/\s+/)
  const uniqueWords = new Set(words)
  const repetitionRatio = uniqueWords.size / words.length
  
  if (repetitionRatio < 0.3 && words.length > 20) {
    issues.push('Text appears to have excessive repetition')
  }
  
  // Check for reasonable character distribution
  const alphaNumericCount = (cleanText.match(/[a-zA-Z0-9]/g) || []).length
  const alphaNumericRatio = alphaNumericCount / cleanText.length
  
  if (alphaNumericRatio < 0.5) {
    issues.push('Text contains too many non-alphanumeric characters')
  }
  
  return {
    isValid: issues.length === 0,
    issues
  }
}

