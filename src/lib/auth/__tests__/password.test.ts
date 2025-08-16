import { describe, it, expect } from "vitest"
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  generateResetToken,
  generateResetTokenExpiry,
  isResetTokenExpired
} from "../password"

describe("Password utilities", () => {
  describe("hashPassword", () => {
    it("should hash a password", async () => {
      const password = "testpassword123"
      const hash = await hashPassword(password)
      
      expect(hash).toBeDefined()
      expect(hash).not.toBe(password)
      expect(hash.length).toBeGreaterThan(50) // bcrypt hashes are typically 60 chars
    })

    it("should generate different hashes for the same password", async () => {
      const password = "testpassword123"
      const hash1 = await hashPassword(password)
      const hash2 = await hashPassword(password)
      
      expect(hash1).not.toBe(hash2)
    })
  })

  describe("verifyPassword", () => {
    it("should verify a correct password", async () => {
      const password = "testpassword123"
      const hash = await hashPassword(password)
      
      const isValid = await verifyPassword(password, hash)
      expect(isValid).toBe(true)
    })

    it("should reject an incorrect password", async () => {
      const password = "testpassword123"
      const wrongPassword = "wrongpassword"
      const hash = await hashPassword(password)
      
      const isValid = await verifyPassword(wrongPassword, hash)
      expect(isValid).toBe(false)
    })
  })

  describe("validatePassword", () => {
    it("should accept valid passwords", () => {
      const validPasswords = [
        "password123",
        "mySecurePass",
        "12345678",
        "a".repeat(8)
      ]

      validPasswords.forEach(password => {
        const result = validatePassword(password)
        expect(result.isValid).toBe(true)
        expect(result.error).toBeUndefined()
      })
    })

    it("should reject passwords shorter than 8 characters", () => {
      const shortPasswords = [
        "1234567",
        "short",
        "a"
      ]

      shortPasswords.forEach(password => {
        const result = validatePassword(password)
        expect(result.isValid).toBe(false)
        expect(result.error).toContain("8 characters")
      })
    })

    it("should reject empty passwords", () => {
      const result = validatePassword("")
      expect(result.isValid).toBe(false)
      expect(result.error).toBe("Password is required")
    })
  })

  describe("generateResetToken", () => {
    it("should generate a token", () => {
      const token = generateResetToken()
      
      expect(token).toBeDefined()
      expect(typeof token).toBe("string")
      expect(token.length).toBe(64) // 32 bytes as hex = 64 chars
    })

    it("should generate unique tokens", () => {
      const token1 = generateResetToken()
      const token2 = generateResetToken()
      
      expect(token1).not.toBe(token2)
    })
  })

  describe("generateResetTokenExpiry", () => {
    it("should generate expiry date 1 hour in the future", () => {
      const now = new Date()
      const expiry = generateResetTokenExpiry()
      
      const diffInMs = expiry.getTime() - now.getTime()
      const diffInHours = diffInMs / (1000 * 60 * 60)
      
      expect(diffInHours).toBeCloseTo(1, 1)
    })
  })

  describe("isResetTokenExpired", () => {
    it("should return false for future dates", () => {
      const futureDate = new Date()
      futureDate.setHours(futureDate.getHours() + 1)
      
      expect(isResetTokenExpired(futureDate)).toBe(false)
    })

    it("should return true for past dates", () => {
      const pastDate = new Date()
      pastDate.setHours(pastDate.getHours() - 1)
      
      expect(isResetTokenExpired(pastDate)).toBe(true)
    })
  })
})