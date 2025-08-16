// Password utilities
export {
  hashPassword,
  verifyPassword,
  validatePassword,
  generateResetToken,
  generateResetTokenExpiry,
  isResetTokenExpired
} from "./password"

// Email utilities
export {
  sendEmail,
  validateEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  generatePasswordResetEmailTemplate,
  generateWelcomeEmailTemplate
} from "./email"

// Validation utilities
export {
  validateSignUpForm,
  validateSignInForm,
  validatePasswordResetForm,
  validateNewPasswordForm,
  validateAndSanitizeEmail,
  sanitizeInput
} from "./validation"

// Configuration utilities
export {
  validateAuthConfig,
  isProviderConfigured,
  getAvailableProviders
} from "./config"

// Development utilities (only available in development)
export {
  logAuthStatus,
  createTestUser,
  mockOAuthProfile
} from "./dev-utils"

// Types
export type { EmailOptions } from "./email"
export type {
  ValidationResult,
  SignUpValidationResult,
  SignInValidationResult
} from "./validation"
export type { AuthConfig } from "./config"