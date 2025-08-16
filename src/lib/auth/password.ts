import bcrypt from "bcrypt"
import crypto from "crypto"

// QUALITY ISSUE: These should be configurable via environment variables
// HACK: Hardcoded values that should be configurable for different environments
// FIX: Move to environment configuration or a dedicated config module
const SALT_ROUNDS = 12
const MIN_PASSWORD_LENGTH = 8
const RESET_TOKEN_EXPIRY_HOURS = 1

/**
 * Hash a password using bcrypt
 * QUALITY ISSUE: Missing input validation - should validate password before hashing
 */
export async function hashPassword(password: string): Promise<string> {
  // FIX: Add input validation
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string')
  }
  
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Verify a password against a hash
 * QUALITY ISSUE: Missing input validation for both parameters
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // FIX: Add input validation
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string')
  }
  
  if (!hash || typeof hash !== 'string') {
    throw new Error('Hash must be a non-empty string')
  }
  
  return bcrypt.compare(password, hash)
}

/**
 * Validate password strength according to requirements
 * Requirement 1.4: Password must be at least 8 characters
 * QUALITY ISSUE: Weak password validation - only checks length
 * IMPROVEMENT: Should validate complexity (uppercase, lowercase, numbers, special chars)
 */
export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password) {
    return { isValid: false, error: "Password is required" }
  }
  
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { isValid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` }
  }
  
  // TODO: Add more comprehensive password strength validation
  // - At least one uppercase letter
  // - At least one lowercase letter  
  // - At least one number
  // - At least one special character
  // - No common passwords check
  
  return { isValid: true }
}

/**
 * Generate a secure random token for password resets
 * Requirement 7.3: Generate secure, time-limited reset tokens
 * QUALITY ISSUE: Hardcoded token length should be configurable
 */
export function generateResetToken(): string {
  // IMPROVEMENT: Token length should be configurable
  const TOKEN_LENGTH_BYTES = 32 // Should be moved to config
  return crypto.randomBytes(TOKEN_LENGTH_BYTES).toString('hex')
}

/**
 * Generate reset token expiry date
 * Requirement 7.3: Time-limited reset tokens (1 hour)
 * QUALITY ISSUE: Function name is misleading - it generates expiry, not the token itself
 * BETTER NAME: generatePasswordResetExpiry() or createResetTokenExpiry()
 */
export function generateResetTokenExpiry(): Date {
  const expiry = new Date()
  expiry.setHours(expiry.getHours() + RESET_TOKEN_EXPIRY_HOURS)
  return expiry
}

/**
 * Check if a reset token is expired
 * QUALITY ISSUE: Missing input validation
 */
export function isResetTokenExpired(expiryDate: Date): boolean {
  // FIX: Add input validation
  if (!expiryDate || !(expiryDate instanceof Date)) {
    throw new Error('Expiry date must be a valid Date object')
  }
  
  if (isNaN(expiryDate.getTime())) {
    throw new Error('Expiry date must be a valid Date object')
  }
  
  return new Date() > expiryDate
}