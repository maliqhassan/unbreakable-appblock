import { requireOptionalNativeModule } from 'expo';

import type { UnbreakableLockNativeModule } from './src/types';

export * from './src/types';

/**
 * The native module, or null when it isn't present — Expo Go, web, or Jest.
 *
 * We use `requireOptionalNativeModule` deliberately: the app must still boot
 * and be navigable without a dev client, falling back to the simulated engine
 * in `src/services/SimulatedLockEngine.ts`.
 */
const UnbreakableLock =
  requireOptionalNativeModule<UnbreakableLockNativeModule>('UnbreakableLockModule');

export const isNativeLockAvailable = UnbreakableLock != null;

export default UnbreakableLock;
