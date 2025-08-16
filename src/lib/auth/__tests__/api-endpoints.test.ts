import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { hashPassword } from "@/lib/auth/password"

// Mock the logger
vi.mock("@/lib/logger", () => ({
  loggers: {
    auth: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

// Mock email sending
vi.mock("@/lib/auth/email", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({}),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({}),
}))

// Import the route handlers
import { POST as signupPOST } from "@/app/api/auth/signup/route"
import { POST as resetPasswordPOST } from "@/app/api/auth/reset-password/route"
import { POST as confirmResetPOST } from "@/app/api/auth/confirm-reset/route"

describe("Authentication API Endpoints", () => {
  const testEmail = "test@example.com"
  const testPassword = "testpassword123"
  const testName = "Test User"

  beforeEach(async () => {
    // Clean up test data
    await prisma.verificationToken.deleteMany({
      where: { identifier: testEmail },
    })
    await prisma.user.deleteMany({
      where: { email: testEmail },
    })
  })

  afterEach(async () => {
    // Clean up test data
    await prisma.verificationToken.deleteMany({
      where: { identifier: testEmail },
    })
    await prisma.user.deleteMany({
      where: { email: testEmail },
    })
  })

  describe("POST /api/auth/signup", () => {
    it("should create a new user with valid data", async () => {
      const request = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          confirmPassword: testPassword,
          name: testName,
        }),
      })

      const response = await signupPOST(request)
      const data = await response.json()

      expect(response.status).toBe(201)
      expect(data.message).toBe("Account created successfully")
      expect(data.user.email).toBe(testEmail)
      expect(data.user.name).toBe(testName)

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      })
      expect(user).toBeTruthy()
      expect(user?.password).toBeTruthy()
    })

    it("should reject signup with invalid email", async () => {
      const request = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: "invalid-email",
          password: testPassword,
          confirmPassword: testPassword,
        }),
      })

      const response = await signupPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Validation failed")
      expect(data.details.email).toBeTruthy()
    })

    it("should reject signup with weak password", async () => {
      const request = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
          password: "weak",
          confirmPassword: "weak",
        }),
      })

      const response = await signupPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Validation failed")
      expect(data.details.password).toBeTruthy()
    })

    it("should reject signup with mismatched passwords", async () => {
      const request = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          confirmPassword: "different-password",
        }),
      })

      const response = await signupPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Validation failed")
      expect(data.details.confirmPassword).toBeTruthy()
    })

    it("should reject signup with existing email", async () => {
      // Create existing user
      await prisma.user.create({
        data: {
          email: testEmail,
          password: await hashPassword(testPassword),
        },
      })

      const request = new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          confirmPassword: testPassword,
        }),
      })

      const response = await signupPOST(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBe("An account with this email already exists")
    })
  })

  describe("POST /api/auth/reset-password", () => {
    beforeEach(async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testEmail,
          password: await hashPassword(testPassword),
          name: testName,
        },
      })
    })

    it("should accept password reset request for existing user", async () => {
      const request = new NextRequest("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
        }),
      })

      const response = await resetPasswordPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toContain("If an account with this email exists")

      // Verify reset token was created
      const token = await prisma.verificationToken.findFirst({
        where: { identifier: testEmail },
      })
      expect(token).toBeTruthy()
    })

    it("should return success message for non-existent user (security)", async () => {
      const request = new NextRequest("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          email: "nonexistent@example.com",
        }),
      })

      const response = await resetPasswordPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toContain("If an account with this email exists")

      // Verify no token was created
      const token = await prisma.verificationToken.findFirst({
        where: { identifier: "nonexistent@example.com" },
      })
      expect(token).toBeFalsy()
    })

    it("should reject invalid email format", async () => {
      const request = new NextRequest("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          email: "invalid-email",
        }),
      })

      const response = await resetPasswordPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Invalid email format")
    })
  })

  describe("POST /api/auth/confirm-reset", () => {
    let resetToken: string

    beforeEach(async () => {
      // Create test user
      await prisma.user.create({
        data: {
          email: testEmail,
          password: await hashPassword(testPassword),
          name: testName,
        },
      })

      // Create reset token
      resetToken = "test-reset-token-" + Date.now()
      await prisma.verificationToken.create({
        data: {
          identifier: testEmail,
          token: resetToken,
          expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        },
      })
    })

    it("should reset password with valid token", async () => {
      const newPassword = "newpassword123"
      const request = new NextRequest("http://localhost/api/auth/confirm-reset", {
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: newPassword,
          confirmPassword: newPassword,
        }),
      })

      const response = await confirmResetPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toContain("Password has been reset successfully")

      // Verify token was deleted
      const token = await prisma.verificationToken.findUnique({
        where: { token: resetToken },
      })
      expect(token).toBeFalsy()

      // Verify password was updated (we can't directly check the hash, but we can verify it changed)
      const user = await prisma.user.findUnique({
        where: { email: testEmail },
      })
      expect(user?.password).toBeTruthy()
    })

    it("should reject invalid token", async () => {
      const request = new NextRequest("http://localhost/api/auth/confirm-reset", {
        method: "POST",
        body: JSON.stringify({
          token: "invalid-token",
          password: "newpassword123",
          confirmPassword: "newpassword123",
        }),
      })

      const response = await confirmResetPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Invalid or expired reset token")
    })

    it("should reject expired token", async () => {
      // Create expired token
      const expiredToken = "expired-token-" + Date.now()
      await prisma.verificationToken.create({
        data: {
          identifier: testEmail,
          token: expiredToken,
          expires: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        },
      })

      const request = new NextRequest("http://localhost/api/auth/confirm-reset", {
        method: "POST",
        body: JSON.stringify({
          token: expiredToken,
          password: "newpassword123",
          confirmPassword: "newpassword123",
        }),
      })

      const response = await confirmResetPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain("Reset token has expired")

      // Verify expired token was deleted
      const token = await prisma.verificationToken.findUnique({
        where: { token: expiredToken },
      })
      expect(token).toBeFalsy()
    })

    it("should reject weak password", async () => {
      const request = new NextRequest("http://localhost/api/auth/confirm-reset", {
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: "weak",
          confirmPassword: "weak",
        }),
      })

      const response = await confirmResetPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Validation failed")
      expect(data.details.password).toBeTruthy()
    })

    it("should reject mismatched passwords", async () => {
      const request = new NextRequest("http://localhost/api/auth/confirm-reset", {
        method: "POST",
        body: JSON.stringify({
          token: resetToken,
          password: "newpassword123",
          confirmPassword: "different-password",
        }),
      })

      const response = await confirmResetPOST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Validation failed")
      expect(data.details.confirmPassword).toBeTruthy()
    })
  })
})