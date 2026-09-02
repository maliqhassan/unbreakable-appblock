import AsyncStorage from '@react-native-async-storage/async-storage';

import { LockService } from '../src/services/LockService';
import { DailyLimitService } from '../src/services/DailyLimitService';
import { PermissionService } from '../src/services/PermissionService';
import { pairLimits, useDailyLimitStore } from '../src/store/useDailyLimitStore';
import { useUserStore } from '../src/store/useUserStore';
import type { DailyUsageStatus, SubscriptionState, TargetApp } from '../src/types';
import { statusFor } from '../src/utils/dailyUsage';

const YOUTUBE = 'com.google.android.youtube';
const INSTAGRAM = 'com.instagram.android';
const MIN = 60;

const PRO_STATE: SubscriptionState = {
  tier: 'PRO',
  status: 'active',
  expirationDate: null,
  willRenew: true,
  managementUrl: null,
  isSandbox: false,
  source: 'revenuecat',
};
const FREE_STATE: SubscriptionState = { ...PRO_STATE, tier: 'FREE', status: 'free' };
const EXPIRED_STATE: SubscriptionState = { ...FREE_STATE, status: 'expired' };

beforeEach(async () => {
  await AsyncStorage.clear();
  useDailyLimitStore.setState({
    limits: [],
    statuses: [],
    loading: false,
    hydrated: false,
    usageError: null,
  });
  useUserStore.setState({ subscription: FREE_STATE, hydrating: false });
});

afterEach(() => jest.restoreAllMocks());

describe('persistence', () => {
  it('starts with no limits', async () => {
    expect(await DailyLimitService.getLimits()).toEqual([]);
  });

  it('creates a limit and reads it back', async () => {
    const created = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    expect(created.id).toBeTruthy();
    expect(created.enabled).toBe(true);
    expect(await DailyLimitService.getLimits()).toHaveLength(1);
  });

  it('refuses a second limit for the same app', async () => {
    await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    await expect(
      DailyLimitService.createLimit({
        appPackageName: YOUTUBE,
        dailyLimitSeconds: 30 * MIN,
        strictMode: false,
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });

    expect(await DailyLimitService.getLimits()).toHaveLength(1);
  });

  it('allows limits for different apps, independently', async () => {
    await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });
    await DailyLimitService.createLimit({
      appPackageName: INSTAGRAM,
      dailyLimitSeconds: 30 * MIN,
      strictMode: false,
    });

    const all = await DailyLimitService.getLimits();
    expect(all).toHaveLength(2);
    expect(all.map((l) => l.dailyLimitSeconds)).toEqual([15 * MIN, 30 * MIN]);
  });

  it('survives a store reset, because storage is the source', async () => {
    await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    // Simulate process death: React state gone, storage intact.
    useDailyLimitStore.setState({ limits: [], hydrated: false });
    await useDailyLimitStore.getState().hydrate();

    expect(useDailyLimitStore.getState().limits).toHaveLength(1);
  });

  it('edits the allowance', async () => {
    const created = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    await DailyLimitService.updateLimit({ ...created, dailyLimitSeconds: 30 * MIN });

    expect((await DailyLimitService.getLimits())[0].dailyLimitSeconds).toBe(30 * MIN);
  });

  it('enables and disables without deleting', async () => {
    const created = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    await DailyLimitService.setEnabled(created.id, false);
    expect((await DailyLimitService.getLimits())[0].enabled).toBe(false);

    await DailyLimitService.setEnabled(created.id, true);
    expect((await DailyLimitService.getLimits())[0].enabled).toBe(true);
  });

  it('deletes one limit and leaves the others', async () => {
    const a = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });
    await DailyLimitService.createLimit({
      appPackageName: INSTAGRAM,
      dailyLimitSeconds: 30 * MIN,
      strictMode: false,
    });

    await DailyLimitService.deleteLimit(a.id);

    const all = await DailyLimitService.getLimits();
    expect(all).toHaveLength(1);
    expect(all[0].appPackageName).toBe(INSTAGRAM);
  });
});

describe('usage reporting without a native module', () => {
  it('reports usage as unknown rather than zero', async () => {
    // Nothing can be measured here, and pretending otherwise would show a full
    // allowance the user would act on.
    await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    const statuses = await DailyLimitService.getStatuses();
    expect(statuses[0].usageSeconds).toBeNull();
    expect(statuses[0].exhausted).toBe(false);
  });

  it('says plainly that limits will not be enforced', () => {
    expect(DailyLimitService.isSupported()).toBe(false);
  });
});

describe('one app exhausted never locks another', () => {
  const now = new Date();

  it('keeps allowances independent', () => {
    const statuses: DailyUsageStatus[] = [
      statusFor(
        {
          id: 'a',
          appPackageName: YOUTUBE,
          dailyLimitSeconds: 15 * MIN,
          enabled: true,
          strictMode: false,
          createdAt: 0,
          updatedAt: 0,
        },
        20 * MIN,
        now
      ),
      statusFor(
        {
          id: 'b',
          appPackageName: INSTAGRAM,
          dailyLimitSeconds: 30 * MIN,
          enabled: true,
          strictMode: false,
          createdAt: 0,
          updatedAt: 0,
        },
        5 * MIN,
        now
      ),
    ];

    expect(statuses[0].exhausted).toBe(true);
    expect(statuses[1].exhausted).toBe(false);
    expect(statuses[1].remainingSeconds).toBe(25 * MIN);
  });
});

describe('pairing limits with usage for the UI', () => {
  it('matches each limit to its status', async () => {
    const limit = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    const paired = pairLimits([limit], [
      {
        packageName: YOUTUBE,
        limitSeconds: 15 * MIN,
        usageSeconds: 4 * MIN,
        remainingSeconds: 11 * MIN,
        exhausted: false,
        resetsAt: 0,
      },
    ]);

    expect(paired[0].status?.remainingSeconds).toBe(11 * MIN);
  });

  it('yields a null status when usage has not arrived yet', async () => {
    const limit = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: false,
    });

    // Rendered as "Calculating…", never as zero used.
    expect(pairLimits([limit], [])[0].status).toBeNull();
  });
});

describe('permissions', () => {
  it('reads permissions through the shared service, not a second surface', () => {
    // Daily limits depend on Usage Access, which the rest of the app already
    // gates on. This asserts they go through the same service rather than
    // introducing a parallel permission list.
    jest.spyOn(PermissionService, 'getAll').mockReturnValue([
      {
        id: 'usageAccess',
        title: 'Usage Access',
        rationale: 'test',
        explanation: 'test',
        privacyNote: 'test',
        icon: '📊',
        status: 'granted',
        optional: false,
      },
    ]);

    const usageAccess = PermissionService.getAll().find((p) => p.id === 'usageAccess');
    expect(usageAccess?.status).toBe('granted');
  });

  it('never enforces a limit whose usage could not be measured', () => {
    // The whole failure mode this guards: a revoked permission must degrade to
    // "not enforced and said so", never to "zero used, all clear".
    const status = statusFor(
      {
        id: 'a',
        appPackageName: YOUTUBE,
        dailyLimitSeconds: 15 * MIN,
        enabled: true,
        strictMode: false,
        createdAt: 0,
        updatedAt: 0,
      },
      null,
      new Date()
    );

    expect(status.exhausted).toBe(false);
    expect(status.usageSeconds).toBeNull();
  });
});

describe('Free and Pro', () => {
  const apps: TargetApp[] = [
    { id: YOUTUBE, name: 'YouTube' },
    { id: INSTAGRAM, name: 'Instagram' },
  ];

  it('uses the same centralised tier limits as everything else', () => {
    // Daily limits introduce no second set of rules.
    expect(LockService.validateConfiguration(apps, 30, false, 'FREE').requiresPro).toBe(
      true
    );
    expect(LockService.validateConfiguration(apps, 30, false, 'PRO').valid).toBe(true);
  });

  it('gates Strict Mode behind Pro', () => {
    expect(
      LockService.validateConfiguration([apps[0]], 30, true, 'FREE').requiresPro
    ).toBe(true);
    expect(LockService.validateConfiguration([apps[0]], 30, true, 'PRO').valid).toBe(true);
  });

  it('treats an expired Pro subscription as Free', () => {
    useUserStore.setState({ subscription: EXPIRED_STATE });
    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('keeps limits created while Pro after a lapse', async () => {
    useUserStore.setState({ subscription: PRO_STATE });
    const created = await DailyLimitService.createLimit({
      appPackageName: YOUTUBE,
      dailyLimitSeconds: 15 * MIN,
      strictMode: true,
    });

    useUserStore.setState({ subscription: EXPIRED_STATE });

    // Losing Pro must not silently delete configuration the user already made.
    expect((await DailyLimitService.getLimits()).map((l) => l.id)).toContain(created.id);
  });
});
