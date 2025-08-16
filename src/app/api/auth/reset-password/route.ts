import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { generateResetToken, generateResetTokenExpiry } from "@/lib/auth/password"
import { validatePasswordResetForm, sanitizeInput } from "@/lib/auth/validation"
import { sendPasswordResetEmail } from "@/lib/auth/email"
import { loggers } from "@/lib/logger"

// Rate limiting map (in production, use Redis or similar)
const resetAttempts = new Map<string, { count: number; lastAttempt: number }>()
const MAX_RESET_ATTEMPTS = 3
const RESET_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(email: string): boolean {
  const now = Date.now()
  const attempts = resetAttempts.get(email)

  if (!attempts) {
    resetAttempts.set(email, { count: 1, lastAttempt: now })
    return true
  }

  // Reset counter if window has passed
  if (now - attempts.lastAttempt > RESET_WINDOW_MS) {
    resetAttempts.set(email, { count: 1, lastAttempt: now })
    return true
  }

  // Check if limit exceeded
  if (attempts.count >= MAX_RESET_ATTEMPTS) {
    return false
  }

  // Increment counter
  attempts.count++
  attempts.lastAttempt = now
  return true
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email: rawEmail } = body

    // Sanitize input
    const email = sanitizeInput(rawEmail || "").toLowerCase()

    // Validate email format
    const validation = validatePasswordResetForm(email)
    
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: "Invalid email format",
          details: validation.error,
        },
        { status: 400 }
      )
    }

    // Check rate limiting
    if (!checkRateLimit(email)) {
      loggers.auth.warn("Password reset rate limit exceeded", { email })
      return NextResponse.json(
        { error: "Too many reset attempts. Please try again later." },
        { status: 429 }
      )
    }

    // Always return success message for security (don't reveal if email exists)
    const successMessage = "If an account with this email exists, you will receive a password reset link shortly."

    try {
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
      })

      if (!user) {
        // Log for monitoring but return success message
        loggers.auth.info("Password reset requested for non-existent email", { email })
        return NextResponse.json({ message: successMessage })
      }

      // Generate reset token and expiry
      const resetToken = generateResetToken()
      const expires = generateResetTokenExpiry()

      // Store reset token in database
      await prisma.verificationToken.create({
        data: {
          identifier: email,
          token: resetToken,
          expires,
        },
      })

      // Send reset email
      await sendPasswordResetEmail(email, resetToken)

      loggers.auth.info("Password reset email sent", {
        userId: user.id,
        email,
        tokenExpiry: expires,
      })

      return NextResponse.json({ message: successMessage })
    } catch (dbError) {
      // If there's a database error, still return success message for security
      loggers.auth.error("Database error during password reset", {
        email,
        error: dbError instanceof Error ? dbError.message : "Unknown error",
      })

      return NextResponse.json({ message: successMessage })
    }
  } catch (error) {
    loggers.auth.error("Password reset request error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}