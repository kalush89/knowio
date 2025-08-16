import { Resend } from "resend"

let resend: Resend | null = null

function getResendClient(): Resend {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY)
  }
  return resend
}

export interface EmailOptions {
  to: string
  subject: string
  html: string
}

/**
 * Send an email using Resend
 */
export async function sendEmail({ to, subject, html }: EmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured")
  }

  if (!process.env.FROM_EMAIL) {
    throw new Error("FROM_EMAIL is not configured")
  }

  try {
    const resendClient = getResendClient()
    const result = await resendClient.emails.send({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html,
    })

    return result
  } catch (error) {
    console.error("Failed to send email:", error)
    throw new Error("Failed to send email")
  }
}

/**
 * Validate email format
 * Requirement 1.3: Validate email format and display appropriate error
 */
export function validateEmail(email: string): { isValid: boolean; error?: string } {
  if (!email) {
    return { isValid: false, error: "Email is required" }
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { isValid: false, error: "Please enter a valid email address" }
  }
  
  return { isValid: true }
}

/**
 * Generate password reset email template
 * Requirement 7.3: Secure, time-limited reset link in email
 */
export function generatePasswordResetEmailTemplate(resetToken: string): string {
  const resetUrl = `${process.env.NEXTAUTH_URL}/auth/new-password?token=${resetToken}`
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Request</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin: 0; font-size: 24px;">Password Reset Request</h1>
        </div>
        
        <div style="margin-bottom: 30px;">
          <p style="color: #666; line-height: 1.6; margin: 0 0 20px 0;">
            You requested a password reset for your account. Click the button below to set a new password:
          </p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="background-color: #007cba; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
            Reset Password
          </a>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0 0 10px 0;">
            <strong>Important:</strong> This link will expire in 1 hour for security reasons.
          </p>
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0;">
            If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 12px; line-height: 1.4; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <span style="word-break: break-all;">${resetUrl}</span>
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Send password reset email
 * Requirement 7.2: Send reset email via Resend
 * Requirement 7.3: Email contains secure, time-limited reset link
 */
export async function sendPasswordResetEmail(email: string, resetToken: string) {
  const html = generatePasswordResetEmailTemplate(resetToken)
  
  return sendEmail({
    to: email,
    subject: "Password Reset Request - Action Required",
    html,
  })
}

/**
 * Generate welcome email template for new users
 */
export function generateWelcomeEmailTemplate(name?: string): string {
  const displayName = name || "there"
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to the Platform</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin: 0; font-size: 24px;">Welcome to the Platform!</h1>
        </div>
        
        <div style="margin-bottom: 30px;">
          <p style="color: #666; line-height: 1.6; margin: 0 0 20px 0;">
            Hi ${displayName},
          </p>
          <p style="color: #666; line-height: 1.6; margin: 0 0 20px 0;">
            Welcome to our AI-powered documentation chat support system! Your account has been successfully created.
          </p>
          <p style="color: #666; line-height: 1.6; margin: 0 0 20px 0;">
            You can now start asking questions about API documentation and get instant, accurate answers powered by AI.
          </p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXTAUTH_URL}" 
             style="background-color: #007cba; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
            Get Started
          </a>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0;">
            If you have any questions or need help getting started, feel free to reach out to our support team.
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail(email: string, name?: string) {
  const html = generateWelcomeEmailTemplate(name)
  
  return sendEmail({
    to: email,
    subject: "Welcome to the Platform!",
    html,
  })
}