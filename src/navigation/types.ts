import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  /** First run only — the three onboarding steps plus the completion screen. */
  OnboardingWelcome: undefined;
  OnboardingHowItWorks: undefined;
  OnboardingPermissions: undefined;
  OnboardingComplete: undefined;

  Home: undefined;
  AppSelection: undefined;
  LockConfiguration: undefined;
  ActiveLock: undefined;
  Permissions: undefined;
  Schedules: undefined;
  DailyLimits: undefined;
  /** Omit limitId to create; pass one to edit. */
  CreateDailyLimit: { limitId?: string } | undefined;
  /**
   * Omit both to start blank, scheduleId to edit an existing schedule, or
   * presetId to seed the form from a routine on the empty state.
   */
  CreateSchedule: { scheduleId?: string; presetId?: string } | undefined;

  /** `origin` tells the screen whether to pop or reset when it finishes. */
  Auth: { origin?: 'onboarding' } | undefined;
  EmailAuth: undefined;
  Account: undefined;

  /** `reason` explains which limit the user hit, so the screen can lead with it. */
  Subscription: { reason?: string } | undefined;

  /** Registered only when __DEV__ — see AppNavigator. */
  Diagnostics: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

/**
 * Declaration merging so `navigation.navigate('Home')` is typed everywhere,
 * including in components that never import RootStackParamList. The empty
 * interface body is the whole point — it only inherits.
 */
declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
