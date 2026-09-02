import type { LockErrorCode, LockErrorShape } from '../types';

/**
 * Every failure that crosses the native boundary is normalised into this.
 * Screens can then switch on `code` instead of string-matching messages.
 */
export class LockError extends Error implements LockErrorShape {
  readonly code: LockErrorCode;

  constructor(code: LockErrorCode, message: string) {
    super(message);
    this.name = 'LockError';
    this.code = code;
  }
}

const DEFAULT_MESSAGES: Record<LockErrorCode, string> = {
  PERMISSION_REQUIRED: 'A required permission has not been granted.',
  UNSUPPORTED_PLATFORM: 'This platform does not support app locking.',
  UNSUPPORTED_OS_VERSION: 'This OS version is too old for app locking.',
  AUTHORIZATION_DENIED: 'Screen Time authorization was denied.',
  ENTITLEMENT_UNAVAILABLE: 'The Family Controls entitlement is not available in this build.',
  EXTENSION_UNAVAILABLE: 'A required system extension is not installed.',
  NO_SELECTION: 'No apps have been selected.',
  INVALID_CONFIGURATION: 'This lock configuration is not valid.',
  STRICT_MODE_ACTIVE: 'Strict Mode is active. This lock cannot be ended early.',
  ALREADY_ACTIVE: 'A lock is already running.',
  NOT_ACTIVE: 'No lock is currently running.',
  PURCHASE_CANCELLED: 'The purchase was cancelled.',
  PURCHASE_FAILED: 'The purchase could not be completed.',
  BILLING_UNAVAILABLE: 'In-app purchases are unavailable on this device.',
  AUTH_UNAVAILABLE: 'Sign-in is not configured in this build.',
  AUTH_CANCELLED: 'Sign-in was cancelled.',
  AUTH_FAILED: 'Sign-in could not be completed.',
  AUTH_REAUTH_REQUIRED: 'Please sign in again to confirm this change.',
  AUTH_INVALID_EMAIL: 'That email address does not look valid.',
  AUTH_EXPIRED_LINK: 'That sign-in link has expired. Request a new one.',
  AUTH_TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a little and try again.',
  AUTH_NETWORK: 'No connection. Check your network and try again.',
  UNKNOWN: 'Something went wrong.',
};

const KNOWN_CODES = new Set(Object.keys(DEFAULT_MESSAGES) as LockErrorCode[]);

function isCode(value: unknown): value is LockErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value as LockErrorCode);
}

/**
 * Turn anything thrown — a native rejection, a JS Error, a string — into a
 * LockError. Native modules reject with `{ code, message }`, so those survive
 * intact; everything else falls back to UNKNOWN.
 */
export function toLockError(err: unknown): LockError {
  if (err instanceof LockError) return err;

  if (err && typeof err === 'object') {
    const raw = err as { code?: unknown; message?: unknown };
    if (isCode(raw.code)) {
      const message =
        typeof raw.message === 'string' && raw.message.length > 0
          ? raw.message
          : DEFAULT_MESSAGES[raw.code];
      return new LockError(raw.code, message);
    }
    if (typeof raw.message === 'string') {
      return new LockError('UNKNOWN', raw.message);
    }
  }

  if (typeof err === 'string') return new LockError('UNKNOWN', err);
  return new LockError('UNKNOWN', DEFAULT_MESSAGES.UNKNOWN);
}

export function messageForCode(code: LockErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
