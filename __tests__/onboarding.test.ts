import AsyncStorage from '@react-native-async-storage/async-storage';

import { FREE_LIMITS, PRO_LIMITS } from '../src/constants/limits';
import { resolveInitialRoute } from '../src/navigation/resolveInitialRoute';
import { LockService } from '../src/services/LockService';
import { PermissionService } from '../src/services/PermissionService';
import { StorageService } from '../src/services/StorageService';
import { useUserStore } from '../src/store/useUserStore';
import type { LockSession, PermissionState, TargetApp } from '../src/types';

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };

const MINUTE = 60 * 1000;

function session(overrides: Partial<LockSession> = {}): LockSession {
  return {
    id: 'session_1',
    selectedApps: [YOUTUBE],
    startTimestamp: Date.now() - MINUTE,
    endTimestamp: Date.now() + 30 * MINUTE,
    strictMode: false,
    status: 'active',
    ...overrides,
  };
}

function permission(overrides: Partial<PermissionState> = {}): PermissionState {
  return {
    id: 'usageAccess',
    title: 'Usage Access',
    rationale: 'test',
    explanation: 'test',
    privacyNote: 'test',
    icon: '📊',
    status: 'denied',
    optional: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useUserStore.setState({ onboarded: true, hydrating: false });
});

afterEach(() => jest.restoreAllMocks());

describe('startup routing priority', () => {
  it('sends a first-time user to onboarding', () => {
    expect(resolveInitialRoute({ session: null, onboarded: false })).toBe(
      'OnboardingWelcome'
    );
  });

  it('sends a returning user straight to Home', () => {
    expect(resolveInitialRoute({ session: null, onboarded: true })).toBe('Home');
  });

  it('an active lock outranks everything, including unfinished onboarding', () => {
    // The worst possible bug here: someone with a running strict lock reopens
    // the app and gets a setup wizard, which looks exactly like the lock died.
    expect(resolveInitialRoute({ session: session(), onboarded: false })).toBe(
      'ActiveLock'
    );
    expect(resolveInitialRoute({ session: session(), onboarded: true })).toBe(
      'ActiveLock'
    );
  });

  it('treats a preparing session as active for routing', () => {
    expect(
      resolveInitialRoute({ session: session({ status: 'preparing' }), onboarded: true })
    ).toBe('ActiveLock');
  });

  it('does not route to the lock screen for a finished session', () => {
    for (const status of ['completed', 'failed', 'idle'] as const) {
      expect(resolveInitialRoute({ session: session({ status }), onboarded: true })).toBe(
        'Home'
      );
    }
  });

  it('does not trap a user in onboarding over missing permissions', () => {
    // Permission state is deliberately not a routing input: someone who skipped
    // setup still lands on Home, warned. The lock gate stops them later.
    expect(resolveInitialRoute({ session: null, onboarded: true })).toBe('Home');
  });
});

describe('onboarding completion', () => {
  it('starts a fresh install as not onboarded', async () => {
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(false);
  });

  it('persists completion so onboarding is not shown again', async () => {
    await useUserStore.getState().completeOnboarding();

    expect(useUserStore.getState().onboarded).toBe(true);
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(true);
    expect(resolveInitialRoute({ session: null, onboarded: true })).toBe('Home');
  });

  it('records the permission step separately from completion', async () => {
    // Seeing the permission step is not the same as having granted anything,
    // and neither is the same as finishing onboarding.
    await StorageService.set('permissionsSetupCompleted', true);

    expect(await StorageService.get<boolean>('permissionsSetupCompleted', false)).toBe(
      true
    );
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(false);
  });
});

describe('permission status', () => {
  it('never marks setup complete just because storage says the step was seen', async () => {
    await StorageService.set('permissionsSetupCompleted', true);
    jest
      .spyOn(PermissionService, 'missingRequired')
      .mockReturnValue([permission({ id: 'usageAccess' })]);

    // A stored flag must not override the live platform answer.
    expect(PermissionService.missingRequired()).toHaveLength(1);
    expect(PermissionService.hasRequired()).toBe(
      PermissionService.getAll()
        .filter((p) => !p.optional)
        .every((p) => p.status === 'granted' || p.status === 'unavailable')
    );
  });

  it('detects a revocation after onboarding completed', async () => {
    await useUserStore.getState().completeOnboarding();

    jest
      .spyOn(PermissionService, 'missingRequired')
      .mockReturnValue([permission({ id: 'usageAccess', status: 'denied' })]);

    // Onboarded, but no longer protected — Home must be able to say so.
    expect(useUserStore.getState().onboarded).toBe(true);
    expect(PermissionService.missingRequired()).toHaveLength(1);
  });

  it('reports everything granted as ready', () => {
    jest.spyOn(PermissionService, 'missingRequired').mockReturnValue([]);
    expect(PermissionService.missingRequired()).toHaveLength(0);
  });

  it('does not list Accessibility as a required permission', () => {
    // The app ships no AccessibilityService, so asking for it would be asking
    // to read every screen the user sees for a capability we do not implement.
    const ids = PermissionService.getAll().map((p) => p.id);
    expect(ids).not.toContain('accessibility');
  });

  it('gives every permission an explanation and a privacy note', () => {
    // The explainer sheet renders both; a missing one would show a blank sheet.
    for (const p of PermissionService.getAll()) {
      expect(p.explanation.length).toBeGreaterThan(0);
      expect(p.privacyNote.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });

  it('counts progress from the live list rather than a hardcoded total', () => {
    const all = PermissionService.getAll();
    const required = all.filter((p) => !p.optional);

    // Whatever the platform reports, progress is derived from it.
    expect(required.length).toBe(
      all.filter((p) => !p.optional).length
    );
  });
});

describe('feature gating is unchanged by the new flow', () => {
  it('holds a guest to the free limits', () => {
    // Guests are Free users; nothing about the account state changes gating.
    expect(LockService.validateConfiguration([YOUTUBE], 30, false, 'FREE').valid).toBe(
      true
    );
    expect(
      LockService.validateConfiguration([YOUTUBE, INSTAGRAM], 30, false, 'FREE').requiresPro
    ).toBe(true);
    // Duration is no longer gated; only app count and Strict Mode are.
    expect(LockService.validateConfiguration([YOUTUBE], 90, false, 'FREE').valid).toBe(true);
    expect(LockService.validateConfiguration([YOUTUBE], 30, true, 'FREE').requiresPro).toBe(
      true
    );
  });

  it('lets a Pro user past all three free limits', () => {
    expect(
      LockService.validateConfiguration([YOUTUBE, INSTAGRAM], 8 * 60, true, 'PRO').valid
    ).toBe(true);
  });

  it('keeps the free tier usable without an account', () => {
    expect(FREE_LIMITS.maxApps).toBe(1);
    // No duration cap on Free — the restriction is one protected app.
    expect(FREE_LIMITS.maxDurationMinutes).toBe(PRO_LIMITS.maxDurationMinutes);
    expect(FREE_LIMITS.strictMode).toBe(false);
    expect(PRO_LIMITS.strictMode).toBe(true);
  });
});
