import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { hashPassword, isResetTokenExpired } from "@/lib/auth/password"
import { validateNewPasswordForm, sanitizeInput } from "@/lib/auth/validation"
import { loggers } from "@/lib/logger"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token: rawToken, password, confirmPassword } = body

    // Sanitize token input
    const token = sanitizeInput(rawToken || "")

    if (!token) {
      return NextResponse.json(
        { error: "Reset token is required" },
        { status: 400 }
      )
    }

    // Validate password form
    const validation = validateNewPasswordForm(password, confirmPassword)
    
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: {
            password: validation.password.error,
            confirmPassword: validation.confirmPassword.error,
          },
        },
        { status: 400 }
      )
    }

    // Find and validate reset token
    const verificationToken = await prisma.verificationToken.findUnique({
      where: { token },
      select: {
        identifier: true,
        token: true,
        expires: true,
      },
    })

    if (!verificationToken) {
      loggers.auth.warn("Invalid reset token used", { token: token.substring(0, 8) + "..." })
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      )
    }

    // Check if token is expired
    if (isResetTokenExpired(verificationToken.expires)) {
      // Clean up expired token
      await prisma.verificationToken.delete({
        where: { token },
      })

      loggers.auth.warn("Expired reset token used", {
        email: verificationToken.identifier,
        expiry: verificationToken.expires,
      })

      return NextResponse.json(
        { error: "Reset token has expired. Please request a new password reset." },
        { status: 400 }
      )
    }

    const email = verificationToken.identifier

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    })

    if (!user) {
      // Clean up token for non-existent user
      await prisma.verificationToken.delete({
        where: { token },
      })

      loggers.auth.error("Reset token found for non-existent user", { email })
      return NextResponse.json(
        { error: "Invalid reset token" },
        { status: 400 }
      )
    }

    // Hash new password
    const hashedPassword = await hashPassword(password)

    // Update user password and delete reset token in a transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      prisma.verificationToken.delete({
        where: { token },
      }),
      // Invalidate all existing sessions for security
      prisma.session.deleteMany({
        where: { userId: user.id },
      }),
    ])

    loggers.auth.info("Password reset completed successfully", {
      userId: user.id,
      email: user.email,
    })

    return NextResponse.json({
      message: "Password has been reset successfully. Please sign in with your new password.",
    })
  } catch (error) {
    loggers.auth.error("Password reset confirmation error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}