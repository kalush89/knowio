# End-to-End Integration Tests

This directory contains comprehensive end-to-end integration tests for the document ingestion system. These tests validate the complete workflow from URL submission to vector storage, including error handling, performance, and scalability scenarios.

## Test Structure

### Core Test Files

1. **`e2e-integration.test.ts`** - Main end-to-end integration tests
   - Complete ingestion workflow validation
   - Concurrent processing scenarios
   - Error handling across the entire pipeline
   - Resource management and cleanup

2. **`real-docs-integration.test.ts`** - Real documentation site testing
   - Tests with realistic API documentation content (Stripe, GitHub, AWS Bedrock)
   - Multi-page documentation processing
   - Real-world error scenarios (rate limiting, access restrictions)

3. **`performance-integration.test.ts`** - Performance and load testing
   - Large document processing performance
   - High concurrency load testing
   - Memory usage and resource cleanup validation
   - Database connection pooling efficiency

### Support Files

- **`e2e-setup.ts`** - Global test environment setup and teardown
- **`run-e2e-tests.ts`** - Test runner script with environment validation
- **`setup.ts`** - Basic test configuration

## Test Categories

### 1. Complete Ingestion Workflow Tests

These tests validate the entire document ingestion pipeline:

- **URL Validation** → **Web Scraping** → **Content Chunking** → **Embedding Generation** → **Vector Storage**

**Key Test Scenarios:**
- Successful end-to-end processing with real documentation URLs
- Multi-page documentation with link following
- Status tracking throughout the process
- Database persistence validation

### 2. Concurrent Processing and Resource Management

Tests that validate system behavior under concurrent load:

- Multiple simultaneous ingestion requests
- Resource limit enforcement and queue management
- Memory usage under pressure
- Database connection pooling

**Performance Targets:**
- Process 10+ concurrent jobs without failure
- Memory growth < 50MB per job
- Average processing time < 5 seconds per job
- Database connection efficiency

### 3. Error Handling and Recovery

Comprehensive error scenario testing:

- URL validation failures
- Web scraping errors (timeouts, access restrictions)
- Embedding service failures (rate limits, API errors)
- Vector storage failures (database issues)
- Partial failure handling

**Recovery Mechanisms:**
- Retry logic with exponential backoff
- Graceful degradation
- Error reporting and logging
- Job status tracking during failures

### 4. Real Documentation Integration

Tests using realistic API documentation content:

- **Stripe API Documentation** - Complex payment API docs
- **GitHub REST API** - Repository and user management APIs
- **Amazon Bedrock** - AI/ML service documentation

**Validation Points:**
- Content extraction accuracy
- Chunk generation quality
- Metadata preservation
- Search relevance

### 5. Performance and Scalability

Load testing and performance validation:

- Large document processing (100+ sections, 200+ chunks)
- Sustained load testing (multiple batches over time)
- Memory efficiency validation
- Processing speed benchmarks

**Performance Metrics:**
- Chunks per second processing rate
- Memory usage per chunk
- Database query efficiency
- API response times

## Running the Tests

### Prerequisites

1. **Test Database**: Ensure you have a separate test database configured
   ```bash
   # Example test database URL
   export DATABASE_URL="postgresql://user:password@localhost:5432/knowio_test"
   ```

2. **Environment Setup**: Install dependencies and generate Prisma client
   ```bash
   npm install
   npm run db:generate
   ```

### Running All E2E Tests

```bash
# Run complete end-to-end test suite
npm run test:e2e

# Run with watch mode for development
npm run test:e2e:watch
```

### Running Specific Test Categories

```bash
# Run only integration tests
npm run test:integration

# Run only unit tests
npm run test:unit

# Run specific test file
npx vitest src/test/e2e-integration.test.ts --run

# Run with verbose output
npx vitest src/test/performance-integration.test.ts --run --reporter=verbose
```

### Test Environment Variables

Required environment variables for testing:

```bash
# Database connection (must include 'test' for safety)
DATABASE_URL="postgresql://user:password@localhost:5432/knowio_test"

# Optional: AWS credentials for embedding tests (mocked by default)
AWS_ACCESS_KEY_ID="test-key"
AWS_SECRET_ACCESS_KEY="test-secret"
AWS_REGION="us-east-1"
```

## Test Utilities

### E2ETestUtils Class

Provides utilities for test data generation and cleanup:

```typescript
// Generate test documentation URLs
const testUrl = E2ETestUtils.generateTestDocumentationUrl('my-test')

// Generate mock scraped content
const mockContent = E2ETestUtils.generateMockScrapedContent(url, 5) // 5 sections

// Generate mock document chunks
const mockChunks = E2ETestUtils.generateMockChunks(url, content)

// Generate mock embeddings
const mockEmbeddings = E2ETestUtils.generateMockEmbeddings(chunks)

// Wait for job completion
const completedJob = await E2ETestUtils.waitForJobCompletion(jobId, 30000)

// Clean up test data
await E2ETestUtils.cleanupDatabase()
```

### PerformanceTestUtils Class

Provides performance testing utilities:

```typescript
// Measure execution time
const { result, duration } = await PerformanceTestUtils.measureExecutionTime(
  () => processor.processJob(jobId)
)

// Generate large content for testing
const largeContent = PerformanceTestUtils.generateLargeContent(100, 1000)

// Generate many chunks for load testing
const manyChunks = PerformanceTestUtils.generateManyChunks(url, 200)

// Measure memory usage
const memoryUsage = await PerformanceTestUtils.measureMemoryUsage()
```

## Test Data Management

### Database Cleanup

Tests automatically clean up data using URL patterns:

- Test URLs contain `test-e2e` or `example.com`
- Cleanup runs before and after each test
- Global cleanup in setup/teardown hooks

### Mock Services

External services are mocked to ensure test reliability:

- **AWS Bedrock**: Mocked embedding generation
- **Playwright**: Mocked browser automation
- **Inngest**: Mocked event sending

### Test Isolation

Each test runs in isolation:

- Separate database cleanup per test
- Mock service reset between tests
- No shared state between test cases

## Performance Benchmarks

### Expected Performance Metrics

Based on test validation, the system should achieve:

| Metric | Target | Test Validation |
|--------|--------|-----------------|
| Processing Speed | > 8 chunks/second | ✅ Performance tests |
| Memory Usage | < 50MB per job | ✅ Memory tests |
| Concurrent Jobs | 10+ simultaneous | ✅ Load tests |
| API Response Time | < 1 second | ✅ Integration tests |
| Large Document | < 25 seconds | ✅ Performance tests |
| Error Recovery | < 3 retries | ✅ Error tests |

### Performance Test Scenarios

1. **Large Document Processing**
   - 100 sections, 200+ chunks
   - Target: < 25 seconds total processing
   - Memory: < 1MB per chunk

2. **High Concurrency**
   - 10 concurrent jobs
   - Target: All complete within 30 seconds
   - No resource conflicts

3. **Sustained Load**
   - 3 batches of 5 jobs each
   - Target: < 50% variation in batch times
   - Consistent throughput

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Ensure test database exists and is accessible
   npx prisma db push --force-reset
   ```

2. **Test Timeouts**
   ```bash
   # Increase timeout in vitest.config.ts
   testTimeout: 60000 // 60 seconds
   ```

3. **Memory Issues**
   ```bash
   # Run with increased memory
   node --max-old-space-size=4096 node_modules/.bin/vitest
   ```

4. **Mock Service Issues**
   ```bash
   # Clear mock state between tests
   vi.clearAllMocks()
   vi.resetAllMocks()
   ```

### Debug Mode

Run tests with debug output:

```bash
# Enable debug logging
DEBUG=* npm run test:e2e

# Run single test with verbose output
npx vitest src/test/e2e-integration.test.ts --run --reporter=verbose
```

## Contributing

When adding new integration tests:

1. **Follow Naming Conventions**
   - Use descriptive test names
   - Group related tests in describe blocks
   - Include performance expectations in test names

2. **Use Test Utilities**
   - Leverage existing utility classes
   - Add new utilities for common patterns
   - Ensure proper cleanup

3. **Mock External Services**
   - Don't make real API calls in tests
   - Use realistic mock data
   - Test both success and failure scenarios

4. **Validate Performance**
   - Include timing assertions
   - Test memory usage
   - Validate resource cleanup

5. **Document Test Scenarios**
   - Add comments explaining complex test logic
   - Document expected behavior
   - Include performance benchmarks