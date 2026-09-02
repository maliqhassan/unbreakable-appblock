import { useCallback, useState } from 'react';

import { useAppForeground } from './useAppForeground';
import { PermissionService } from '../services/PermissionService';
import type { PermissionState } from '../types';

export interface PermissionStatusSummary {
  /** Every permission this platform uses, with live status. */
  permissions: PermissionState[];
  /** Only the non-optional ones. */
  required: PermissionState[];
  /** Required permissions still outstanding. */
  missing: PermissionState[];
  /** How many required permissions are granted. */
  granted: number;
  /** Total required. Never hardcode this — the list can change per platform. */
  total: number;
  /** True when every required permission is granted. */
  ready: boolean;
  /** Re-reads from the platform. */
  refresh: () => void;
}

/**
 * Live permission status, straight from Android.
 *
 * The one rule this hook exists to enforce: **status is never read from
 * storage.** Android is asked every time, and asked again whenever the app
 * returns to the foreground — which is the only moment a grant made in Settings
 * can be observed, and equally the only moment a revocation can.
 *
 * Every screen that shows permission state uses this, so onboarding, Home and
 * the requirements gate can never disagree with each other.
 */
export function usePermissionStatus(): PermissionStatusSummary {
  const [permissions, setPermissions] = useState<PermissionState[]>(() =>
    PermissionService.getAll()
  );

  const refresh = useCallback(() => setPermissions(PermissionService.getAll()), []);

  // Returning from Settings is when a grant — or a revocation — becomes visible.
  useAppForeground(refresh);

  const required = permissions.filter((p) => !p.optional);
  const missing = required.filter(
    (p) => p.status !== 'granted' && p.status !== 'unavailable'
  );

  return {
    permissions,
    required,
    missing,
    granted: required.length - missing.length,
    total: required.length,
    ready: missing.length === 0,
    refresh,
  };
}
