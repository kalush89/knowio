import { validateEmail } from "./email"
import { validatePassword } from "./password"

// Re-export for convenience
export { validateEmail } from "./email"
export { validatePassword } from "./password"

export interface ValidationResult {
  isValid: boolean
  error?: string
}

export interface SignUpValidationResult {
  email: ValidationResult
  password: ValidationResult
  confirmPassword: ValidationResult
  isValid: boolean
}

export interface SignInValidationResult {
  email: ValidationResult
  password: ValidationResult
  isValid: boolean
}

/**
 * Validate sign-up form data
 * Requirements 1.3, 1.4: Email format and password strength validation
 */
export function validateSignUpForm(
  email: string,
  password: string,
  confirmPassword: string
): SignUpValidationResult {
  const emailValidation = validateEmail(email)
  const passwordValidation = validatePassword(password)
  
  let confirmPasswordValidation: ValidationResult
  if (!confirmPassword) {
    confirmPasswordValidation = { isValid: false, error: "Please confirm your password" }
  } else if (password !== confirmPassword) {
    confirmPasswordValidation = { isValid: false, error: "Passwords do not match" }
  } else {
    confirmPasswordValidation = { isValid: true }
  }
  
  const isValid = emailValidation.isValid && passwordValidation.isValid && confirmPasswordValidation.isValid
  
  return {
    email: emailValidation,
    password: passwordValidation,
    confirmPassword: confirmPasswordValidation,
    isValid
  }
}

/**
 * Validate sign-in form data
 * Requirement 1.3: Email format validation
 */
export function validateSignInForm(email: string, password: string): SignInValidationResult {
  const emailValidation = validateEmail(email)
  
  let passwordValidation: ValidationResult
  if (!password) {
    passwordValidation = { isValid: false, error: "Password is required" }
  } else {
    passwordValidation = { isValid: true }
  }
  
  const isValid = emailValidation.isValid && passwordValidation.isValid
  
  return {
    email: emailValidation,
    password: passwordValidation,
    isValid
  }
}

/**
 * Validate password reset form data
 */
export function validatePasswordResetForm(email: string): ValidationResult {
  return validateEmail(email)
}

/**
 * Validate new password form data
 * Requirement 1.4: Password strength validation
 */
export function validateNewPasswordForm(
  password: string,
  confirmPassword: string
): { password: ValidationResult; confirmPassword: ValidationResult; isValid: boolean } {
  const passwordValidation = validatePassword(password)
  
  let confirmPasswordValidation: ValidationResult
  if (!confirmPassword) {
    confirmPasswordValidation = { isValid: false, error: "Please confirm your password" }
  } else if (password !== confirmPassword) {
    confirmPasswordValidation = { isValid: false, error: "Passwords do not match" }
  } else {
    confirmPasswordValidation = { isValid: true }
  }
  
  const isValid = passwordValidation.isValid && confirmPasswordValidation.isValid
  
  return {
    password: passwordValidation,
    confirmPassword: confirmPasswordValidation,
    isValid
  }
}

/**
 * Sanitize user input to prevent XSS attacks
 */
export function sanitizeInput(input: string): string {
  if (!input) return ""
  
  return input
    .trim()
    .replace(/[<>]/g, "") // Remove angle brackets
    .substring(0, 255) // Limit length
}

/**
 * Validate and sanitize email input
 */
export function validateAndSanitizeEmail(email: string): { email: string; validation: ValidationResult } {
  const sanitizedEmail = sanitizeInput(email).toLowerCase()
  const validation = validateEmail(sanitizedEmail)
  
  return {
    email: sanitizedEmail,
    validation
  }
}