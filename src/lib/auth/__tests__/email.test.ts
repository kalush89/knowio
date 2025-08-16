import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  validateEmail,
  generatePasswordResetEmailTemplate,
  generateWelcomeEmailTemplate
} from "../email"

// Mock environment variables for tests
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-api-key')
  vi.stubEnv('FROM_EMAIL', 'test@example.com')
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
})

describe("Email utilities", () => {
  describe("validateEmail", () => {
    it("should accept valid email addresses", () => {
      const validEmails = [
        "test@example.com",
        "user.name@domain.co.uk",
        "user+tag@example.org",
        "123@example.com",
        "test@sub.domain.com"
      ]

      validEmails.forEach(email => {
        const result = validateEmail(email)
        expect(result.isValid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })

    it("should reject invalid email addresses", () => {
      const invalidEmails = [
        "invalid-email",
        "@example.com",
        "test@",
        "test.example.com",
        "test@.com",
        "test@com",
        ""
      ]

      invalidEmails.forEach(email => {
        const result = validateEmail(email)
        expect(result.isValid).toBe(false)
        expect(result.error).toBeDefined()
      })
    })

    it("should reject empty emails", () => {
      const result = validateEmail("")
      expect(result.isValid).toBe(false)
      expect(result.error).toBe("Email is required")
    })
  })

  describe("generatePasswordResetEmailTemplate", () => {
    it("should generate HTML template with reset token", () => {
      const token = "test-reset-token-123"
      const html = generatePasswordResetEmailTemplate(token)
      
      expect(html).toContain("Password Reset Request")
      expect(html).toContain(token)
      expect(html).toContain("Reset Password")
      expect(html).toContain("1 hour")
      expect(html).toContain("<!DOCTYPE html>")
    })

    it("should include the reset URL with token", () => {
      const token = "test-token"
      const html = generatePasswordResetEmailTemplate(token)
      
      expect(html).toContain(`/auth/new-password?token=${token}`)
    })
  })

  describe("generateWelcomeEmailTemplate", () => {
    it("should generate HTML template with default greeting", () => {
      const html = generateWelcomeEmailTemplate()
      
      expect(html).toContain("Welcome to the Platform!")
      expect(html).toContain("Hi there,")
      expect(html).toContain("Get Started")
      expect(html).toContain("<!DOCTYPE html>")
    })

    it("should generate HTML template with custom name", () => {
      const name = "John Doe"
      const html = generateWelcomeEmailTemplate(name)
      
      expect(html).toContain("Welcome to the Platform!")
      expect(html).toContain(`Hi ${name},`)
      expect(html).toContain("Get Started")
    })
  })
})