# Authentication Utilities

This directory contains core authentication utilities for the user authentication system. These utilities support the requirements for secure user authentication, password management, and email functionality.

## Overview

The authentication utilities are organized into three main modules:

- **Password utilities** (`password.ts`) - Password hashing, validation, and reset token management
- **Email utilities** (`email.ts`) - Email validation, template generation, and sending
- **Validation utilities** (`validation.ts`) - Form validation and input sanitization

## Requirements Coverage

These utilities implement the following requirements:

- **1.3**: Email format validation with appropriate error messages
- **1.4**: Password strength validation (minimum 8 characters)
- **7.3**: Secure, time-limited reset tokens for password reset emails
- **7.4**: Support for password reset form validation

## Password Utilities

### Functions

- `hashPassword(password: string)` - Hash passwords using bcrypt with 12 salt rounds
- `verifyPassword(password: string, hash: string)` - Verify passwords against bcrypt hashes
- `validatePassword(password: string)` - Validate password meets minimum requirements
- `generateResetToken()` - Generate cryptographically secure reset tokens
- `generateResetTokenExpiry()` - Generate expiry date (1 hour from now)
- `isResetTokenExpired(expiryDate: Date)` - Check if reset token has expired

### Security Features

- Uses bcrypt with 12 salt rounds for password hashing
- Generates cryptographically secure reset tokens (32 bytes as hex)
- Time-limited reset tokens (1 hour expiration)
- Password strength validation (minimum 8 characters)

## Email Utilities

### Functions

- `validateEmail(email: string)` - Validate email format using regex
- `sendEmail(options: EmailOptions)` - Send emails via Resend API
- `sendPasswordResetEmail(email: string, token: string)` - Send password reset emails
- `sendWelcomeEmail(email: string, name?: string)` - Send welcome emails to new users
- `generatePasswordResetEmailTemplate(token: string)` - Generate HTML email template
- `generateWelcomeEmailTemplate(name?: string)` - Generate welcome email template

### Email Templates

The email templates are responsive HTML templates that include:

- Professional styling with inline CSS
- Clear call-to-action buttons
- Security information and expiration notices
- Fallback text links for accessibility
- Mobile-responsive design

### Environment Variables

Required environment variables:

- `RESEND_API_KEY` - API key for Resend email service
- `FROM_EMAIL` - Sender email address
- `NEXTAUTH_URL` - Base URL for reset links

## Validation Utilities

### Functions

- `validateSignUpForm(email, password, confirmPassword)` - Validate registration forms
- `validateSignInForm(email, password)` - Validate sign-in forms
- `validatePasswordResetForm(email)` - Validate password reset requests
- `validateNewPasswordForm(password, confirmPassword)` - Validate new password forms
- `sanitizeInput(input: string)` - Sanitize user input to prevent XSS
- `validateAndSanitizeEmail(email: string)` - Combined email validation and sanitization

### Validation Rules

- **Email**: Must be valid email format using regex pattern
- **Password**: Minimum 8 characters required
- **Confirm Password**: Must match the original password
- **Input Sanitization**: Removes angle brackets, trims whitespace, limits length

## Usage Examples

### Password Management

```typescript
import { hashPassword, verifyPassword, validatePassword } from '@/lib/auth'

// Hash a password for storage
const hashedPassword = await hashPassword('userPassword123')

// Verify password during login
const isValid = await verifyPassword('userPassword123', hashedPassword)

// Validate password strength
const validation = validatePassword('short') // { isValid: false, error: "..." }
```

### Email Functionality

```typescript
import { sendPasswordResetEmail, validateEmail } from '@/lib/auth'

// Validate email format
const emailValidation = validateEmail('user@example.com')

// Send password reset email
if (emailValidation.isValid) {
  const resetToken = generateResetToken()
  await sendPasswordResetEmail('user@example.com', resetToken)
}
```

### Form Validation

```typescript
import { validateSignUpForm } from '@/lib/auth'

const validation = validateSignUpForm(
  'user@example.com',
  'password123',
  'password123'
)

if (validation.isValid) {
  // Proceed with registration
} else {
  // Display validation errors
  console.log(validation.email.error)
  console.log(validation.password.error)
  console.log(validation.confirmPassword.error)
}
```

## Testing

All utilities include comprehensive unit tests covering:

- Password hashing and verification
- Email validation and template generation
- Form validation scenarios
- Input sanitization
- Error handling

Run tests with:

```bash
npm test src/lib/auth/__tests__
```

## Security Considerations

- Passwords are hashed using bcrypt with 12 salt rounds
- Reset tokens are cryptographically secure and time-limited
- Input sanitization prevents basic XSS attacks
- Email validation prevents malformed email addresses
- All sensitive operations include proper error handling

## Integration

These utilities are designed to integrate with:

- NextAuth.js for authentication flows
- Prisma for database operations
- Resend for email delivery
- React forms for client-side validation

The utilities are exported through the main index file for easy importing throughout the application.