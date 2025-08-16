// Simple test runner to verify our implementations
const { estimateTokenCount, preprocessText, sanitizeContent, splitIntoSentences } = require('./src/lib/utils.ts')

console.log('Testing utility functions...')

// Test estimateTokenCount
console.log('Token count for "Hello, world!":', estimateTokenCount('Hello, world!'))
console.log('Token count for "What is this? It is a test.":', estimateTokenCount('What is this? It is a test.'))

// Test preprocessText
console.log('Preprocessed "line1\\n\\n\\n\\nline2":', JSON.stringify(preprocessText('line1\n\n\n\nline2')))

// Test sanitizeContent
console.log('Sanitized script tag:', JSON.stringify(sanitizeContent('Hello <script>alert("bad")</script> world')))

// Test splitIntoSentences
console.log('Split sentences "Hello! How are you?":', splitIntoSentences('Hello! How are you?'))

console.log('All tests completed!')