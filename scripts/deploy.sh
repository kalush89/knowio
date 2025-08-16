#!/bin/bash

# Production deployment script for document ingestion system
# This script handles the complete deployment process

set -e  # Exit on any error

# Configuration
ENVIRONMENT=${1:-production}
SKIP_TESTS=${2:-false}
SKIP_MIGRATIONS=${3:-false}
DEPLOYMENT_VERSION=${4:-$(date +%Y%m%d-%H%M%S)}

echo "🚀 Starting deployment for environment: $ENVIRONMENT"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check production readiness
check_production_readiness() {
    if [ "$ENVIRONMENT" = "production" ]; then
        log_info "Performing production readiness checks..."
        
        # Check for production environment file
        if [ ! -f ".env.production" ]; then
            log_error "Production environment file (.env.production) not found"
            exit 1
        fi
        
        # Check critical environment variables are set
        source .env.production
        critical_vars=("DATABASE_URL" "DIRECT_URL" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "NEXTAUTH_SECRET")
        for var in "${critical_vars[@]}"; do
            if [ -z "${!var}" ]; then
                log_error "Critical production variable $var is not set in .env.production"
                exit 1
            fi
        done
        
        # Check database connectivity
        log_info "Testing database connectivity..."
        if ! npm run db:migrate:status > /dev/null 2>&1; then
            log_warning "Database connectivity check failed - ensure database is accessible"
        fi
        
        log_success "Production readiness checks passed"
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js version 18 or higher is required"
        exit 1
    fi
    
    # Check npm/pnpm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed"
        exit 1
    fi
    
    # Check environment variables
    if [ "$ENVIRONMENT" = "production" ]; then
        required_vars=("DATABASE_URL" "DIRECT_URL" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "NEXTAUTH_SECRET")
        for var in "${required_vars[@]}"; do
            if [ -z "${!var}" ]; then
                log_error "Required environment variable $var is not set"
                exit 1
            fi
        done
    fi
    
    log_success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    
    if [ -f "package-lock.json" ]; then
        npm ci --production=false
    else
        npm install
    fi
    
    log_success "Dependencies installed"
}

# Run tests
run_tests() {
    if [ "$SKIP_TESTS" = "true" ]; then
        log_warning "Skipping tests (SKIP_TESTS=true)"
        return
    fi
    
    log_info "Running tests..."
    
    # Run unit tests
    npm run test:unit
    
    # Run integration tests (only in non-production environments)
    if [ "$ENVIRONMENT" != "production" ]; then
        npm run test:integration
    fi
    
    log_success "All tests passed"
}

# Build application
build_application() {
    log_info "Building application..."
    
    # Set NODE_ENV for build
    export NODE_ENV=$ENVIRONMENT
    export DEPLOYMENT_VERSION=$DEPLOYMENT_VERSION
    export DEPLOYMENT_ENVIRONMENT=$ENVIRONMENT
    
    # Generate Prisma client
    npm run db:generate
    
    # Build Next.js application
    npm run build
    
    log_success "Application built successfully"
}

# Run database migrations
run_migrations() {
    if [ "$SKIP_MIGRATIONS" = "true" ]; then
        log_warning "Skipping database migrations (SKIP_MIGRATIONS=true)"
        return
    fi
    
    log_info "Running database migrations..."
    
    if [ "$ENVIRONMENT" = "production" ]; then
        # Use production migration command
        npm run db:migrate:prod
    else
        # Use development migration command
        npm run db:migrate
    fi
    
    log_success "Database migrations completed"
}

# Seed database (development only)
seed_database() {
    if [ "$ENVIRONMENT" = "production" ]; then
        log_info "Skipping database seeding in production"
        return
    fi
    
    log_info "Seeding database..."
    npm run db:seed
    log_success "Database seeded"
}

# Health check
health_check() {
    log_info "Performing health check..."
    
    # Wait for application to start
    sleep 5
    
    # Check if health endpoint is accessible
    if command -v curl &> /dev/null; then
        HEALTH_URL="${NEXTAUTH_URL:-http://localhost:3000}/api/monitoring/health"
        
        if curl -f -s "$HEALTH_URL" > /dev/null; then
            log_success "Health check passed"
        else
            log_warning "Health check failed - application may still be starting"
        fi
    else
        log_warning "curl not available - skipping health check"
    fi
}

# Cleanup old files
cleanup() {
    log_info "Cleaning up..."
    
    # Remove old build artifacts
    rm -rf .next/cache
    
    # Clean npm cache
    npm cache clean --force
    
    log_success "Cleanup completed"
}

# Main deployment process
main() {
    echo "========================================"
    echo "Document Ingestion System Deployment"
    echo "Environment: $ENVIRONMENT"
    echo "Skip Tests: $SKIP_TESTS"
    echo "Skip Migrations: $SKIP_MIGRATIONS"
    echo "Version: $DEPLOYMENT_VERSION"
    echo "========================================"
    
    check_prerequisites
    check_production_readiness
    install_dependencies
    run_tests
    build_application
    run_migrations
    seed_database
    
    if [ "$ENVIRONMENT" = "production" ]; then
        log_info "Starting production server..."
        # In production, this would typically be handled by a process manager
        # npm start &
        # health_check
    else
        log_info "Development deployment completed"
        log_info "Start the server with: npm run dev"
    fi
    
    cleanup
    
    log_success "Deployment completed successfully! 🎉"
    
    echo ""
    echo "Next steps:"
    echo "1. Verify the application is running correctly"
    echo "2. Check logs for any errors"
    echo "3. Run smoke tests if available"
    echo "4. Monitor system health"
}

# Handle script interruption
trap 'log_error "Deployment interrupted"; exit 1' INT TERM

# Run main function
main