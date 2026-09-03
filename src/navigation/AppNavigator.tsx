import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { AccountButton } from '../components/AccountButton';
import { getColors, motion } from '../constants/theme';
import { LogoLoader } from '../components/LogoLoader';
import { AccountScreen } from '../screens/AccountScreen';
import { ActiveLockScreen } from '../screens/ActiveLockScreen';
import { AppSelectionScreen } from '../screens/AppSelectionScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { EmailAuthScreen } from '../screens/EmailAuthScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { LockConfigurationScreen } from '../screens/LockConfigurationScreen';
import { OnboardingCompleteScreen } from '../screens/OnboardingCompleteScreen';
import { OnboardingHowItWorksScreen } from '../screens/OnboardingHowItWorksScreen';
import { OnboardingPermissionsScreen } from '../screens/OnboardingPermissionsScreen';
import { OnboardingWelcomeScreen } from '../screens/OnboardingWelcomeScreen';
import { CreateDailyLimitScreen } from '../screens/CreateDailyLimitScreen';
import { CreateScheduleScreen } from '../screens/CreateScheduleScreen';
import { DailyLimitsScreen } from '../screens/DailyLimitsScreen';
import { PermissionsScreen } from '../screens/PermissionsScreen';
import { SchedulesScreen } from '../screens/SchedulesScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { resolveInitialRoute } from './resolveInitialRoute';
import { AuthService } from '../services/AuthService';
import { useAuthStore } from '../store/useAuthStore';
import { useLockStore } from '../store/useLockStore';
import { useUserStore } from '../store/useUserStore';
import { log } from '../utils/logger';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  const scheme = useColorScheme();
  const colors = getColors(scheme);

  const hydrated = useLockStore((s) => s.hydrated);
  const hydrateLock = useLockStore((s) => s.hydrate);
  const session = useLockStore((s) => s.session);
  const hydrateUser = useUserStore((s) => s.hydrate);
  const onboarded = useUserStore((s) => s.onboarded);
  const userHydrating = useUserStore((s) => s.hydrating);
  const initializeAuth = useAuthStore((s) => s.initialize);
  const completeEmailSignIn = useAuthStore((s) => s.completeEmailSignIn);

  useEffect(() => {
    void hydrateLock();
    void hydrateUser();
  }, [hydrateLock, hydrateUser]);

  useEffect(() => initializeAuth(), [initializeAuth]);

  /**
   * Completes email sign-in when the user opens the link we mailed them.
   *
   * Handles both a cold start (getInitialURL) and a warm one (the listener).
   * The link is never logged — it carries a one-time credential.
   */
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !AuthService.isEmailSignInLink(url)) return;
      void completeEmailSignIn(url).catch(() => {
        log.warn('Auth', 'Email sign-in link could not be completed');
      });
    };

    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, [completeEmailSignIn]);

  // Nothing renders until we know whether a lock is running and whether
  // onboarding has been seen. Deciding early would flash the wrong screen.
  if (!hydrated || userHydrating) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <LogoLoader label="Starting Unbreakable Lock" />
      </View>
    );
  }

  const navigationTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
    },
  };

  // Priority lives in one tested function rather than inline here.
  const initialRoute = resolveInitialRoute({ session, onboarded });

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.background },
          // One transition for the whole app. Left unset, native-stack picks a
          // default per platform and per presentation, so pushes and modals
          // arrived differently on different screens for no reason the user
          // could see.
          animation: 'slide_from_right',
          animationDuration: motion.base,
        }}
      >
        <Stack.Group
          screenOptions={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
        >
          <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcomeScreen} />
          <Stack.Screen
            name="OnboardingHowItWorks"
            component={OnboardingHowItWorksScreen}
          />
          <Stack.Screen
            name="OnboardingPermissions"
            component={OnboardingPermissionsScreen}
          />
          <Stack.Screen name="OnboardingComplete" component={OnboardingCompleteScreen} />
        </Stack.Group>

        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: 'Unbreakable Lock',
            headerRight: () => <AccountButton />,
          }}
        />
        <Stack.Screen
          name="AppSelection"
          component={AppSelectionScreen}
          options={{ title: 'Choose apps' }}
        />
        <Stack.Screen
          name="LockConfiguration"
          component={LockConfigurationScreen}
          options={{ title: 'Configure your lock' }}
        />
        <Stack.Screen
          name="ActiveLock"
          component={ActiveLockScreen}
          options={({ navigation }) => ({
            title: 'Lock Active',
            // Back is allowed: it navigates, it does not end anything. The lock
            // lives in the native service, so leaving this screen cannot stop
            // it. Trapping the user here was a UI mistake, not a safety
            // measure — Strict Mode is enforced natively, by refusing
            // stopLock(), not by hiding the chevron.
            headerBackVisible: true,
            gestureEnabled: true,
            // Reopening the app during a lock lands here as the *first* screen,
            // so there is nothing beneath it and `headerBackVisible` has no
            // back button to show. That left the screen with no way out at all.
            // Give it an explicit way home in that case.
            headerLeft: navigation.canGoBack()
              ? undefined
              : () => <HeaderHomeButton onPress={() => navigation.navigate('Home')} />,
          })}
        />
        <Stack.Screen
          name="Permissions"
          component={PermissionsScreen}
          options={{ title: 'Permissions' }}
        />
        <Stack.Screen
          name="Insights"
          component={InsightsScreen}
          options={{ title: 'Screen time' }}
        />
        <Stack.Screen
          name="DailyLimits"
          component={DailyLimitsScreen}
          options={{ title: 'Daily limits' }}
        />
        <Stack.Screen
          name="CreateDailyLimit"
          component={CreateDailyLimitScreen}
          options={{ title: 'Daily limit' }}
        />
        <Stack.Screen
          name="Schedules"
          component={SchedulesScreen}
          options={{ title: 'Schedules' }}
        />
        <Stack.Screen
          name="CreateSchedule"
          component={CreateScheduleScreen}
          options={{ title: 'New schedule' }}
        />
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ title: 'Sign in', presentation: 'modal' }}
        />
        <Stack.Screen
          name="EmailAuth"
          component={EmailAuthScreen}
          options={{ title: 'Email' }}
        />
        <Stack.Screen
          name="Account"
          component={AccountScreen}
          options={{ title: 'Account' }}
        />
        <Stack.Screen
          name="Subscription"
          component={SubscriptionScreen}
          options={{ title: 'Pro', presentation: 'modal' }}
        />
        {/*
          Reachable in release too, from Account -> Troubleshooting. It shows
          only permission and service status, never user data, and it is the
          only way to tell "enforcement is off" from "enforcement is broken"
          on a real device.
        */}
        <Stack.Screen
          name="Diagnostics"
          component={DiagnosticsScreen}
          options={{ title: 'Troubleshooting' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * A back affordance for a screen that has nothing behind it.
 *
 * The native header hides its own chevron when the stack has a single entry,
 * which is exactly the state ActiveLock is in after the app is reopened during
 * a lock. This puts one back, pointed at Home.
 */
function HeaderHomeButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="active-lock-home"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back to home"
      hitSlop={12}
      style={({ pressed }) => [headerStyles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={headerStyles.chevron}>‹</Text>
    </Pressable>
  );
}

const headerStyles = StyleSheet.create({
  button: { paddingRight: 16, paddingVertical: 4 },
  chevron: { fontSize: 30, lineHeight: 32, color: '#FFFFFF', fontWeight: '300' },
});
