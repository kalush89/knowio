# Scripts Documentation

## Environment Validation Script

The `validate-environment.js` script validates all environment variables and external service connections required for the RAG system to function properly.

### Usage

```bash
npm run validate-env
```

### What it validates

1. **Environment Variables**
   - Required variables from `.env.example`
   - Format validation for URLs, keys, and secrets
   - Length validation for security-sensitive values

2. **Database Connection**
   - PostgreSQL connection test
   - pgvector extension availability
   - Basic query execution

3. **AWS Bedrock Connection**
   - AWS credentials validation
   - Bedrock service accessibility
   - Titan embedding model availability

4. **Inngest Configuration**
   - Event and signing key presence
   - Basic format validation

5. **Optional Configuration**
   - Performance settings
   - Monitoring configuration
   - Production deployment settings

### Exit Codes

- `0`: All validations passed
- `1`: One or more validations failed

### Example Output

```
🚀 Environment Validation Script

🔍 Validating Environment Variables...
✓ All required environment variables are present and valid
✓ Database URL format is valid
✓ AWS Access Key ID format is valid
✓ AWS Secret Access Key length is valid
✓ NEXTAUTH_SECRET length is adequate

🗄️ Validating Database Connection...
✓ Database connection successful
✓ Database queries working
✓ pgvector extension is installed

🤖 Validating AWS Bedrock Connection...
✓ AWS Bedrock connection successful

⚡ Validating Inngest Configuration...
✓ Inngest event key format looks valid
✓ Inngest signing key format looks valid

🔧 Validating Optional Configuration...
✓ Optional variable HEALTH_CHECK_API_KEY is configured
✓ MAX_CONCURRENT_JOBS is valid: 5

📋 Validation Summary
✅ All validations passed: 12/12 checks successful
Environment is ready for deployment!
```

### Setting up Environment

1. Copy `.env.example` to `.env.local`:
   ```bash
   copy .env.example .env.local
   ```

2. Fill in the required values in `.env.local`

3. Run the validation script to verify your setup:
   ```bash
   npm run validate-env
   ```

### Troubleshooting

**Database Connection Issues:**
- Ensure PostgreSQL is running
- Check DATABASE_URL format
- Verify pgvector extension is installed

**AWS Bedrock Issues:**
- Verify AWS credentials are correct
- Check AWS region configuration
- Ensure Bedrock service is available in your region

**Inngest Issues:**
- Verify event and signing keys are set
- Check key format and length

For more details, see the main project documentation.