# Deployment Guide

This guide covers the deployment process for the Document Ingestion System in both development and production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [Deployment Process](#deployment-process)
5. [Health Monitoring](#health-monitoring)
6. [Troubleshooting](#troubleshooting)
7. [Rollback Procedures](#rollback-procedures)

## Prerequisites

### System Requirements

- **Node.js**: Version 18 or higher
- **PostgreSQL**: Version 14 or higher with pgvector extension
- **AWS Account**: With Bedrock access enabled
- **Memory**: Minimum 2GB RAM (4GB+ recommended for production)
- **Storage**: Minimum 10GB available space

### Required Services

- **AWS Bedrock**: For embedding generation
- **PostgreSQL with pgvector**: For vector storage
- **Inngest**: For background job processing (optional but recommended)

## Environment Configuration

### Development Environment

1. Copy the example environment file:
```bash
cp .env.example .env.local
```

2. Configure the required variables:
```bash
# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/knowio_dev?pgbouncer=true"
DIRECT_URL="postgresql://username:password@localhost:5432/knowio_dev"

# AWS Bedrock Configuration
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your-access-key-id"
AWS_SECRET_ACCESS_KEY="your-secret-access-key"

# Inngest Configuration
INNGEST_EVENT_KEY="your-inngest-event-key"
INNGEST_SIGNING_KEY="your-inngest-signing-key"

# Next.js Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-nextauth-secret"
```

### Production Environment

1. Create production environment file:
```bash
cp .env.production .env.production.local
```

2. Configure production-specific settings:
```bash
# Production Environment Configuration
NODE_ENV="production"
LOG_LEVEL="info"
DEPLOYMENT_VERSION="1.0.0"
DEPLOYMENT_ENVIRONMENT="production"

# Database Configuration (Production)
DATABASE_URL="your-production-database-url"
DIRECT_URL="your-production-direct-database-url"
DATABASE_MAX_CONNECTIONS="25"
DATABASE_CONNECTION_TIMEOUT="90000"

# Security Configuration
HEALTH_CHECK_API_KEY="your-secure-api-key"
RATE_LIMIT_REQUESTS_PER_MINUTE="100"

# Monitoring Configuration
ENABLE_METRICS="true"
METRICS_RETENTION_HOURS="168"
ALERT_WEBHOOK_URL="https://your-monitoring-service.com/webhook"
METRICS_EXPORT_INTERVAL="60000"

# Performance Configuration
MAX_CONCURRENT_JOBS="20"
EMBEDDING_BATCH_SIZE="25"
SCRAPING_TIMEOUT_MS="60000"
```

## Database Setup

### Initial Setup

1. **Install PostgreSQL with pgvector**:
```bash
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib
sudo apt-get install postgresql-14-pgvector

# macOS with Homebrew
brew install postgresql pgvector
```

2. **Create database and user**:
```sql
CREATE DATABASE knowio_production;
CREATE USER knowio_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE knowio_production TO knowio_user;
```

3. **Enable pgvector extension**:
```sql
\c knowio_production
CREATE EXTENSION IF NOT EXISTS vector;
```

### Migration Process

1. **Development migrations**:
```bash
npm run db:migrate
```

2. **Production migrations**:
```bash
npm run db:migrate:prod
```

3. **Check migration status**:
```bash
npm run db:migrate:status
```

### Database Seeding

1. **Development seeding** (includes sample data):
```bash
npm run db:seed
```

2. **Production seeding** (system data only):
```bash
npm run db:seed:prod
```

## Deployment Process

### Automated Deployment

Use the deployment script for streamlined deployment:

```bash
# Development deployment
./scripts/deploy.sh development

# Production deployment
./scripts/deploy.sh production false false v1.0.0

# Skip tests (not recommended for production)
./scripts/deploy.sh production true false v1.0.0

# Skip migrations (use with caution)
./scripts/deploy.sh production false true v1.0.0
```

### Manual Deployment Steps

1. **Install dependencies**:
```bash
npm ci --production=false
```

2. **Run tests**:
```bash
npm run test:unit
npm run test:integration  # Development only
```

3. **Build application**:
```bash
npm run build
```

4. **Run database migrations**:
```bash
npm run db:migrate:prod  # Production
npm run db:migrate       # Development
```

5. **Seed database** (if needed):
```bash
npm run db:seed:prod     # Production
npm run db:seed          # Development
```

6. **Start application**:
```bash
npm start
```

### Docker Deployment (Optional)

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t document-ingestion .
docker run -p 3000:3000 --env-file .env.production document-ingestion
```

## Health Monitoring

### Health Check Endpoints

1. **Basic health check**:
```bash
curl http://localhost:3000/api/monitoring/health
```

2. **Authenticated health check** (production):
```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/monitoring/health
```

3. **Metrics endpoint**:
```bash
curl http://localhost:3000/api/monitoring/metrics
```

### Monitoring Setup

1. **Configure monitoring service** (e.g., DataDog, New Relic):
   - Set up health check monitoring
   - Configure alert webhooks
   - Set up log aggregation

2. **Set up automated alerts**:
   - Database connectivity issues
   - High memory usage
   - API latency spikes
   - Error rate increases

### Key Metrics to Monitor

- **System Health**: CPU, memory, disk usage
- **Database Performance**: Connection pool, query latency
- **API Performance**: Response times, error rates
- **Processing Metrics**: Job completion rates, embedding success rates
- **Business Metrics**: Documents processed, active jobs

## Troubleshooting

### Common Issues

1. **Database Connection Errors**:
```bash
# Check database connectivity
npm run db:migrate:status

# Verify environment variables
echo $DATABASE_URL
```

2. **AWS Bedrock Access Issues**:
```bash
# Test AWS credentials
aws bedrock list-foundation-models --region us-east-1
```

3. **Memory Issues**:
```bash
# Check memory usage
curl http://localhost:3000/api/monitoring/metrics | jq '.memoryStatus'

# Force garbage collection
curl -X POST http://localhost:3000/api/monitoring/metrics \
  -H "Content-Type: application/json" \
  -d '{"action": "forceGarbageCollection"}'
```

4. **High Error Rates**:
```bash
# Check error logs
tail -f logs/application.log | grep ERROR

# Check health status
curl http://localhost:3000/api/monitoring/health
```

### Log Analysis

1. **Application logs location**:
   - Development: Console output
   - Production: `logs/application.log`

2. **Log levels**:
   - `DEBUG`: Detailed debugging information
   - `INFO`: General information
   - `WARN`: Warning conditions
   - `ERROR`: Error conditions

3. **Structured logging** (production):
```bash
# Filter by component
cat logs/application.log | jq 'select(.component == "WebScraper")'

# Filter by error severity
cat logs/application.log | jq 'select(.level == "ERROR")'
```

## Rollback Procedures

### Application Rollback

1. **Stop current application**:
```bash
# If using PM2
pm2 stop document-ingestion

# If using systemd
sudo systemctl stop document-ingestion
```

2. **Deploy previous version**:
```bash
git checkout previous-stable-tag
npm ci --production=false
npm run build
npm start
```

### Database Rollback

1. **Check migration history**:
```bash
npm run db:migrate:status
```

2. **Rollback migrations** (if necessary):
```bash
# This is dangerous - backup first!
npx prisma migrate reset --force
npx prisma migrate deploy
```

### Emergency Procedures

1. **Circuit breaker activation**:
   - Automatically triggered on repeated failures
   - Manual activation via monitoring endpoint

2. **Graceful degradation**:
   - Disable non-essential features
   - Reduce processing load
   - Switch to read-only mode if needed

3. **Data backup**:
```bash
# Backup database
pg_dump -h localhost -U knowio_user knowio_production > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup vector data specifically
pg_dump -h localhost -U knowio_user -t document_chunks knowio_production > vectors_backup_$(date +%Y%m%d_%H%M%S).sql
```

## Performance Optimization

### Production Tuning

1. **Database optimization**:
```sql
-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM document_chunks WHERE embedding <-> $1 < 0.5;

-- Update statistics
ANALYZE document_chunks;

-- Vacuum regularly
VACUUM ANALYZE document_chunks;
```

2. **Connection pooling**:
   - Configure `DATABASE_MAX_CONNECTIONS`
   - Monitor connection usage
   - Implement connection timeout

3. **Memory management**:
   - Monitor heap usage
   - Configure garbage collection
   - Implement batch processing limits

### Scaling Considerations

1. **Horizontal scaling**:
   - Load balancer configuration
   - Session management
   - Database read replicas

2. **Vertical scaling**:
   - CPU and memory upgrades
   - Database performance tuning
   - SSD storage optimization

## Security Considerations

### Production Security

1. **Environment variables**:
   - Never commit secrets to version control
   - Use secure secret management
   - Rotate credentials regularly

2. **API security**:
   - Enable rate limiting
   - Implement request validation
   - Use HTTPS in production

3. **Database security**:
   - Use connection encryption
   - Implement proper user permissions
   - Regular security updates

### Compliance

1. **Data protection**:
   - Implement data retention policies
   - Secure data transmission
   - Regular security audits

2. **Monitoring and logging**:
   - Log security events
   - Monitor for suspicious activity
   - Implement alerting for security issues

## Support and Maintenance

### Regular Maintenance Tasks

1. **Weekly**:
   - Review error logs
   - Check system performance
   - Verify backup integrity

2. **Monthly**:
   - Update dependencies
   - Review security patches
   - Performance optimization review

3. **Quarterly**:
   - Disaster recovery testing
   - Security audit
   - Capacity planning review

### Getting Help

1. **Documentation**: Check this guide and API documentation
2. **Logs**: Review application and system logs
3. **Monitoring**: Check health and metrics endpoints
4. **Support**: Contact the development team with specific error details

---

For additional support or questions about deployment, please refer to the project documentation or contact the development team.