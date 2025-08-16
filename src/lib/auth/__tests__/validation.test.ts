import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  validateSignUpForm,
  validateSignInForm,
  validatePasswordResetForm,
  validateNewPasswordForm,
  sanitizeInput,
  validateAndSanitizeEmail
} from "../validation"

// Mock environment variables for tests
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-api-key')
  vi.stubEnv('FROM_EMAIL', 'test@example.com')
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
})

describe("Validation utilities", () => {
  describe("validateSignUpForm", () => {
    it("should validate correct sign-up data", () => {
      const result = validateSignUpForm(
        "test@example.com",
        "password123",
        "password123"
      )
      
      expect(result.isValid).toBe(true)
      expect(result.email.isValid).toBe(true)
      expect(result.password.isValid).toBe(true)
      expect(result.confirmPassword.isValid).toBe(true)
    })

    it("should reject invalid email", () => {
      const result = validateSignUpForm(
        "invalid-email",
        "password123",
        "password123"
      )
      
      expect(result.isValid).toBe(false)
      expect(result.email.isValid).toBe(false)
      expect(result.email.error).toContain("valid email")
    })

    it("should reject short password", () => {
      const result = validateSignUpForm(
        "test@example.com",
        "short",
        "short"
      )
      
      expect(result.isValid).toBe(false)
      expect(result.password.isValid).toBe(false)
      expect(result.password.error).toContain("8 characters")
    })

    it("should reject mismatched passwords", () => {
      const result = validateSignUpForm(
        "test@example.com",
        "password123",
        "different123"
      )
      
      expect(result.isValid).toBe(false)
      expect(result.confirmPassword.isValid).toBe(false)
      expect(result.confirmPassword.error).toContain("do not match")
    })

    it("should reject empty confirm password", () => {
      const result = validateSignUpForm(
        "test@example.com",
        "password123",
        ""
      )
      
      expect(result.isValid).toBe(false)
      expect(result.confirmPassword.isValid).toBe(false)
      expect(result.confirmPassword.error).toContain("confirm your password")
    })
  })

  describe("validateSignInForm", () => {
    it("should validate correct sign-in data", () => {
      const result = validateSignInForm("test@example.com", "password123")
      
      expect(result.isValid).toBe(true)
      expect(result.email.isValid).toBe(true)
      expect(result.password.isValid).toBe(true)
    })

    it("should reject invalid email", () => {
      const result = validateSignInForm("invalid-email", "password123")
      
      expect(result.isValid).toBe(false)
      expect(result.email.isValid).toBe(false)
    })

    it("should reject empty password", () => {
      const result = validateSignInForm("test@example.com", "")
      
      expect(result.isValid).toBe(false)
      expect(result.password.isValid).toBe(false)
      expect(result.password.error).toBe("Password is required")
    })
  })

  describe("validatePasswordResetForm", () => {
    it("should validate correct email", () => {
      const result = validatePasswordResetForm("test@example.com")
      
      expect(result.isValid).toBe(true)
    })

    it("should reject invalid email", () => {
      const result = validatePasswordResetForm("invalid-email")
      
      expect(result.isValid).toBe(false)
      expect(result.error).toContain("valid email")
    })
  })

  describe("validateNewPasswordForm", () => {
    it("should validate matching strong passwords", () => {
      const result = validateNewPasswordForm("password123", "password123")
      
      expect(result.isValid).toBe(true)
      expect(result.password.isValid).toBe(true)
      expect(result.confirmPassword.isValid).toBe(true)
    })

    it("should reject short password", () => {
      const result = validateNewPasswordForm("short", "short")
      
      expect(result.isValid).toBe(false)
      expect(result.password.isValid).toBe(false)
      expect(result.password.error).toContain("8 characters")
    })

    it("should reject mismatched passwords", () => {
      const result = validateNewPasswordForm("password123", "different123")
      
      expect(result.isValid).toBe(false)
      expect(result.confirmPassword.isValid).toBe(false)
      expect(result.confirmPassword.error).toContain("do not match")
    })
  })

  describe("sanitizeInput", () => {
    it("should trim whitespace", () => {
      expect(sanitizeInput("  test  ")).toBe("test")
    })

    it("should remove angle brackets", () => {
      expect(sanitizeInput("test<script>alert('xss')</script>")).toBe("testscriptalert('xss')/script")
    })

    it("should limit length to 255 characters", () => {
      const longString = "a".repeat(300)
      const result = sanitizeInput(longString)
      expect(result.length).toBe(255)
    })

    it("should handle empty input", () => {
      expect(sanitizeInput("")).toBe("")
      expect(sanitizeInput(null as any)).toBe("")
      expect(sanitizeInput(undefined as any)).toBe("")
    })
  })

  describe("validateAndSanitizeEmail", () => {
    it("should sanitize and validate email", () => {
      const result = validateAndSanitizeEmail("  TEST@EXAMPLE.COM  ")
      
      expect(result.email).toBe("test@example.com")
      expect(result.validation.isValid).toBe(true)
    })

    it("should sanitize and reject invalid email", () => {
      const result = validateAndSanitizeEmail("  invalid-email  ")
      
      expect(result.email).toBe("invalid-email")
      expect(result.validation.isValid).toBe(false)
    })
  })
})