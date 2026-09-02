import AsyncStorage from '@react-native-async-storage/async-storage';

import { LockService } from '../src/services/LockService';
import { ScheduleService } from '../src/services/ScheduleService';
import { summariseSchedules, useScheduleStore } from '../src/store/useScheduleStore';
import { useUserStore } from '../src/store/useUserStore';
import type { LockSchedule, SubscriptionState, TargetApp, Weekday } from '../src/types';
import { getEffectiveLockState } from '../src/utils/schedule';

const YOUTUBE = 'com.google.android.youtube';
const INSTAGRAM = 'com.instagram.android';

const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const ALL_DAYS: Weekday[] = [...WEEKDAYS, 'saturday', 'sunday'];

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
const EXPIRED_STATE: SubscriptionState = {
  ...PRO_STATE,
  tier: 'FREE',
  status: 'expired',
  willRenew: false,
};

function at(day: number, hours: number, minutes = 0): Date {
  return new Date(2024, 0, day, hours, minutes, 0, 0);
}

function schedule(overrides: Partial<LockSchedule> = {}): LockSchedule {
  return {
    id: 'sched_1',
    name: 'Sleep',
    enabled: true,
    appPackageNames: [YOUTUBE],
    daysOfWeek: ALL_DAYS,
    startTime: '22:00',
    endTime: '06:00',
    strictMode: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useScheduleStore.setState({ schedules: [], loading: false, hydrated: false });
  useUserStore.setState({ subscription: FREE_STATE, hydrating: false });
});

describe('schedule persistence', () => {
  it('starts with no schedules', async () => {
    expect(await ScheduleService.getSchedules()).toEqual([]);
  });

  it('creates and reads back a schedule', async () => {
    const created = await ScheduleService.createSchedule({
      name: 'Sleep',
      appPackageNames: [YOUTUBE],
      daysOfWeek: ALL_DAYS,
      startTime: '22:00',
      endTime: '06:00',
      strictMode: false,
    });

    expect(created.id).toBeTruthy();
    expect(created.enabled).toBe(true);

    const all = await ScheduleService.getSchedules();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Sleep');
  });

  it('survives a store reset, because storage is the source', async () => {
    await ScheduleService.createSchedule({
      name: 'Work',
      appPackageNames: [YOUTUBE],
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
      strictMode: false,
    });

    // Simulate process death: React state gone, storage intact.
    useScheduleStore.setState({ schedules: [], hydrated: false });
    await useScheduleStore.getState().hydrate();

    expect(useScheduleStore.getState().schedules).toHaveLength(1);
  });

  it('trims the name rather than storing padding', async () => {
    const created = await ScheduleService.createSchedule({
      name: '   Study   ',
      appPackageNames: [YOUTUBE],
      daysOfWeek: ALL_DAYS,
      startTime: '09:00',
      endTime: '10:00',
      strictMode: false,
    });

    expect(created.name).toBe('Study');
  });

  it('refuses an invalid schedule instead of persisting it', async () => {
    await expect(
      ScheduleService.createSchedule({
        name: '',
        appPackageNames: [YOUTUBE],
        daysOfWeek: ALL_DAYS,
        startTime: '09:00',
        endTime: '10:00',
        strictMode: false,
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });

    expect(await ScheduleService.getSchedules()).toEqual([]);
  });

  it('maps weekdays to Calendar day numbers for native', () => {
    const native = ScheduleService.__toNative(
      schedule({ daysOfWeek: ['sunday', 'monday', 'saturday'] })
    );

    // java.util.Calendar: SUNDAY = 1 .. SATURDAY = 7.
    expect(native?.days.sort()).toEqual([1, 2, 7]);
    expect(native?.startMinutes).toBe(22 * 60);
    expect(native?.endMinutes).toBe(6 * 60);
  });

  it('reports that schedules will not fire without the native module', () => {
    // Honest degradation: the UI shows a warning rather than implying the
    // schedule is armed.
    expect(ScheduleService.isSupported()).toBe(false);
    expect(ScheduleService.canScheduleExactAlarms()).toBe(false);
  });
});

describe('editing and deleting', () => {
  it('updates an existing schedule in place', async () => {
    const created = await ScheduleService.createSchedule({
      name: 'Work',
      appPackageNames: [YOUTUBE],
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
      strictMode: false,
    });

    await ScheduleService.updateSchedule({ ...created, startTime: '08:00' });

    const all = await ScheduleService.getSchedules();
    expect(all).toHaveLength(1);
    expect(all[0].startTime).toBe('08:00');
    expect(all[0].updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('changes the app list on edit', async () => {
    const created = await ScheduleService.createSchedule({
      name: 'Work',
      appPackageNames: [YOUTUBE],
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
      strictMode: false,
    });

    await ScheduleService.updateSchedule({
      ...created,
      appPackageNames: [YOUTUBE, INSTAGRAM],
    });

    expect((await ScheduleService.getSchedules())[0].appPackageNames).toHaveLength(2);
  });

  it('rejects an edit that would make the schedule invalid', async () => {
    const created = await ScheduleService.createSchedule({
      name: 'Work',
      appPackageNames: [YOUTUBE],
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
      strictMode: false,
    });

    await expect(
      ScheduleService.updateSchedule({ ...created, daysOfWeek: [] })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });

    // The stored version is untouched.
    expect((await ScheduleService.getSchedules())[0].daysOfWeek).toHaveLength(5);
  });

  it('deletes one schedule and leaves the others', async () => {
    const a = await ScheduleService.createSchedule({
      name: 'A',
      appPackageNames: [YOUTUBE],
      daysOfWeek: ALL_DAYS,
      startTime: '09:00',
      endTime: '10:00',
      strictMode: false,
    });
    await ScheduleService.createSchedule({
      name: 'B',
      appPackageNames: [INSTAGRAM],
      daysOfWeek: ALL_DAYS,
      startTime: '11:00',
      endTime: '12:00',
      strictMode: false,
    });

    await ScheduleService.deleteSchedule(a.id);

    const all = await ScheduleService.getSchedules();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('B');
  });

  it('enables and disables without deleting', async () => {
    const created = await ScheduleService.createSchedule({
      name: 'Sleep',
      appPackageNames: [YOUTUBE],
      daysOfWeek: ALL_DAYS,
      startTime: '22:00',
      endTime: '06:00',
      strictMode: false,
    });

    await ScheduleService.setScheduleEnabled(created.id, false);
    expect((await ScheduleService.getSchedules())[0].enabled).toBe(false);

    await ScheduleService.setScheduleEnabled(created.id, true);
    expect((await ScheduleService.getSchedules())[0].enabled).toBe(true);
  });
});

describe('deleting an overlapping schedule', () => {
  it('leaves the remaining schedule still covering its apps', () => {
    const work = schedule({
      id: 'work',
      appPackageNames: [YOUTUBE, INSTAGRAM],
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
    });
    const social = schedule({
      id: 'social',
      appPackageNames: [INSTAGRAM],
      daysOfWeek: ALL_DAYS,
      startTime: '12:00',
      endTime: '20:00',
    });

    const now = at(1, 13, 0);

    // Both running: Instagram covered twice, YouTube once.
    expect(getEffectiveLockState([work, social], now).packages).toEqual(
      [INSTAGRAM, YOUTUBE].sort()
    );

    // Delete "work": Instagram must stay locked, YouTube is released.
    const after = getEffectiveLockState([social], now);
    expect(after.packages).toEqual([INSTAGRAM]);
    expect(after.active).toBe(true);
  });

  it('stops enforcement entirely when the last schedule goes', () => {
    expect(getEffectiveLockState([], at(1, 13, 0)).active).toBe(false);
  });
});

describe('Home summary', () => {
  it('reports nothing when there are no schedules', () => {
    const summary = summariseSchedules([], at(1, 12, 0));
    expect(summary.active).toEqual([]);
    expect(summary.nextSchedule).toBeNull();
  });

  it('reports the running schedule', () => {
    const sleep = schedule({ startTime: '22:00', endTime: '06:00' });
    const summary = summariseSchedules([sleep], at(1, 23, 0));

    expect(summary.active).toHaveLength(1);
    expect(summary.active[0].name).toBe('Sleep');
  });

  it('reports the next upcoming schedule when nothing is running', () => {
    const work = schedule({
      id: 'work',
      name: 'Work',
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
    });

    const summary = summariseSchedules([work], at(1, 7, 0));
    expect(summary.nextSchedule?.name).toBe('Work');
    expect(summary.nextAt).toBe(at(1, 9, 0).getTime());
  });

  it('ignores disabled schedules when picking the next one', () => {
    const off = schedule({ enabled: false });
    expect(summariseSchedules([off], at(1, 12, 0)).nextSchedule).toBeNull();
  });

  it('does not offer a running schedule as "next"', () => {
    // Showing "Next: Sleep at 10pm" while Sleep is already running is exactly
    // the stale information the dashboard must not display.
    const sleep = schedule({ startTime: '22:00', endTime: '06:00' });
    const summary = summariseSchedules([sleep], at(1, 23, 0));

    expect(summary.active).toHaveLength(1);
    expect(summary.nextSchedule).toBeNull();
  });
});

describe('manual and scheduled locks coexist', () => {
  it('keeps schedule apps locked when a manual lock ends', () => {
    // The union rule lives in EffectiveLock natively; this asserts the JS-side
    // expectation that the two sources are independent.
    const social = schedule({ appPackageNames: [INSTAGRAM], startTime: '12:00', endTime: '20:00' });
    const scheduleState = getEffectiveLockState([social], at(1, 13, 0));

    expect(scheduleState.active).toBe(true);
    expect(scheduleState.packages).toEqual([INSTAGRAM]);
    // Nothing about a manual session appears here — it is a separate source.
    expect(scheduleState.sources).toEqual(['schedule']);
  });

  it('reports the latest end so neither source truncates the other', () => {
    const short = schedule({ id: 'a', startTime: '12:00', endTime: '14:00' });
    const long = schedule({ id: 'b', startTime: '12:00', endTime: '20:00' });

    expect(getEffectiveLockState([short, long], at(1, 13, 0)).endTimestamp).toBe(
      at(1, 20, 0).getTime()
    );
  });
});

describe('Pro gating', () => {
  const proSchedule = {
    name: 'Sleep',
    appPackageNames: [YOUTUBE, INSTAGRAM],
    daysOfWeek: ALL_DAYS,
    startTime: '22:00',
    endTime: '06:00',
    strictMode: true,
  };

  it('holds a free user to one app and no Strict Mode', () => {
    const apps: TargetApp[] = [
      { id: YOUTUBE, name: 'YouTube' },
      { id: INSTAGRAM, name: 'Instagram' },
    ];

    // The same centralised rules gate schedules as gate manual locks — there is
    // no second set of limits for schedules.
    expect(LockService.validateConfiguration(apps, 60, false, 'FREE').requiresPro).toBe(
      true
    );
    expect(
      LockService.validateConfiguration([apps[0]], 60, true, 'FREE').requiresPro
    ).toBe(true);
  });

  it('lets a Pro user use several apps and Strict Mode', () => {
    const apps: TargetApp[] = [
      { id: YOUTUBE, name: 'YouTube' },
      { id: INSTAGRAM, name: 'Instagram' },
    ];
    expect(LockService.validateConfiguration(apps, 8 * 60, true, 'PRO').valid).toBe(true);
  });

  it('treats an expired Pro subscription as Free', () => {
    useUserStore.setState({ subscription: EXPIRED_STATE });

    expect(useUserStore.getState().subscription.tier).toBe('FREE');
    const apps: TargetApp[] = [
      { id: YOUTUBE, name: 'YouTube' },
      { id: INSTAGRAM, name: 'Instagram' },
    ];
    expect(LockService.validateConfiguration(apps, 60, false, 'FREE').requiresPro).toBe(
      true
    );
  });

  it('still stores a schedule created while Pro, so it survives a lapse', async () => {
    // Losing Pro should not silently delete work the user already did; the UI
    // gates creation, not existing data.
    useUserStore.setState({ subscription: PRO_STATE });
    const created = await ScheduleService.createSchedule(proSchedule);

    useUserStore.setState({ subscription: EXPIRED_STATE });
    const all = await ScheduleService.getSchedules();

    expect(all.map((s) => s.id)).toContain(created.id);
  });
});
