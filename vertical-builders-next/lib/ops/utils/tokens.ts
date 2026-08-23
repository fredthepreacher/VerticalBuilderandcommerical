import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Vendor upload links.
 *
 * The plaintext token exists exactly once: in the link handed to the vendor.
 * Only its SHA-256 hash is stored, so a database leak cannot be replayed as an
 * upload. Tokens are 32 random bytes — vendor ids are never exposed in the URL
 * and there is nothing to enumerate.
 */

export function generateUploadToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison so token validation cannot be timed. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface TokenState {
  valid: boolean
  reason?: 'not_found' | 'expired' | 'revoked' | 'used'
  message?: string
}

export interface TokenRow {
  expires_at: string
  revoked_at: string | null
  used_at: string | null
}

/**
 * Pure state check, extracted so it can be unit-tested without a database.
 * A used token stays valid until it expires — vendors routinely need to send a
 * second page (an endorsement, a corrected certificate) from the same link.
 */
export function checkTokenState(row: TokenRow | null, now: Date = new Date()): TokenState {
  if (!row) {
    return { valid: false, reason: 'not_found', message: 'This upload link is not valid.' }
  }
  if (row.revoked_at) {
    return {
      valid: false,
      reason: 'revoked',
      message: 'This upload link has been revoked. Please contact the office for a new one.',
    }
  }
  if (new Date(row.expires_at).getTime() < now.getTime()) {
    return {
      valid: false,
      reason: 'expired',
      message: 'This upload link has expired. Please contact the office for a new one.',
    }
  }
  return { valid: true }
}
