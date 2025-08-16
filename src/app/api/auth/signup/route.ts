import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { hashPassword } from "@/lib/auth/password"
import { validateSignUpForm, sanitizeInput } from "@/lib/auth/validation"
import { sendWelcomeEmail } from "@/lib/auth/email"
import { loggers } from "@/lib/logger"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email: rawEmail, password, confirmPassword, name: rawName } = body

    // Sanitize inputs
    const email = sanitizeInput(rawEmail || "").toLowerCase()
    const name = rawName ? sanitizeInput(rawName) : undefined

    // Validate form data
    const validation = validateSignUpForm(email, password, confirmPassword)
    
    if (!validation.isValid) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: {
            email: validation.email.error,
            password: validation.password.error,
            confirmPassword: validation.confirmPassword.error,
          },
        },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      loggers.auth.warn("Signup attempt with existing email", { email })
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    })

    // Send welcome email (non-blocking)
    try {
      await sendWelcomeEmail(email, name)
      loggers.auth.info("Welcome email sent", { userId: user.id, email })
    } catch (emailError) {
      // Log error but don't fail the signup
      loggers.auth.error("Failed to send welcome email", {
        userId: user.id,
        email,
        error: emailError instanceof Error ? emailError.message : "Unknown error",
      })
    }

    loggers.auth.info("User signup successful", {
      userId: user.id,
      email,
      method: "credentials",
    })

    return NextResponse.json(
      {
        message: "Account created successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    loggers.auth.error("Signup error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}