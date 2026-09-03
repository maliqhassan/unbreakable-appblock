import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import { PRO_BENEFITS } from '../constants/limits';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import type { SubscriptionStatus } from '../types';
import { toLockError } from '../utils/errors';

/**
 * The subscription screen — paywall for Free users, membership status for Pro.
 *
 * Cancellation is deliberately not implemented here. Google requires it to go
 * through Play, so the Pro view links out to the platform's own management
 * screen instead of pretending to own that flow.
 */
export function SubscriptionScreen({ navigation, route }: ScreenProps<'Subscription'>) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);

  const {
    isPro,
    status,
    subscription,
    priceString,
    priceState,
    isSimulated,
    purchasePro,
    restorePurchases,
  } = useSubscription();

  // Never a placeholder figure: the price shown must be the one Google Play
  // will charge, in this customer's currency, or nothing at all.
  const priceLabel =
    priceState === 'ready' && priceString ? `${priceString} / month` : null;
  const priceUnavailable = priceState === 'unavailable';

  const reason = route.params?.reason;

  const handlePurchase = useCallback(async () => {
    setBusy('purchase');
    try {
      const next = await purchasePro();
      if (next.tier === 'PRO') {
        navigation.goBack();
      } else {
        Alert.alert('Not activated', 'The purchase went through but Pro is not active yet.');
      }
    } catch (err) {
      const error = toLockError(err);
      // Backing out of the Play sheet is a normal action, not an error.
      if (error.code !== 'PURCHASE_CANCELLED') {
        Alert.alert('Purchase failed', error.message);
      }
    } finally {
      setBusy(null);
    }
  }, [navigation, purchasePro]);

  const handleRestore = useCallback(async () => {
    setBusy('restore');
    try {
      const next = await restorePurchases();
      if (next.tier === 'PRO') {
        Alert.alert('Pro restored', 'Your subscription is active again.');
      } else {
        Alert.alert(
          'Nothing to restore',
          'No active Pro subscription was found for this Google account.'
        );
      }
    } catch (err) {
      Alert.alert('Restore failed', toLockError(err).message);
    } finally {
      setBusy(null);
    }
  }, [restorePurchases]);

  const handleManage = useCallback(async () => {
    const url = subscription.managementUrl;
    if (!url) {
      // RevenueCat only supplies this for real store purchases. Send the user
      // to the right place anyway rather than dead-ending them.
      Alert.alert(
        'Manage subscription',
        'Open the Google Play Store, then Menu → Payments & subscriptions → Subscriptions.'
      );
      return;
    }

    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open Play', 'Manage your subscription in the Play Store app.');
    }
  }, [subscription.managementUrl]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {isPro ? (
          <ProHeader status={status} expirationDate={subscription.expirationDate} />
        ) : (
          <>
            <Text style={[styles.title, { color: colors.text }]}>Unlock Pro</Text>
            <Text style={[styles.subtitleText, { color: colors.textMuted }]}>
              Get more control over your focus.
            </Text>
            <Text
              style={[
                styles.price,
                { color: priceLabel ? colors.accent : colors.textFaint },
              ]}
            >
              {priceLabel ?? (priceState === 'loading' ? 'Loading price…' : '')}
            </Text>
          </>
        )}

        {reason && !isPro ? (
          <View style={[styles.reason, { backgroundColor: colors.surfaceMuted }]}>
            <Text style={[styles.reasonText, { color: colors.textMuted }]}>{reason}</Text>
          </View>
        ) : null}

        <Card title={isPro ? 'Your Pro features' : 'What you get'}>
          {PRO_BENEFITS.map((benefit) => (
            <View key={benefit} style={styles.benefitRow}>
              <Text style={[styles.check, { color: colors.success }]}>✓</Text>
              <Text style={[styles.benefit, { color: colors.text }]}>{benefit}</Text>
            </View>
          ))}
        </Card>

        {isPro ? <StatusDetail /> : null}

        {priceUnavailable && !isPro ? (
          <View style={[styles.alert, { borderColor: colors.warning }]}>
            <Text style={[styles.alertTitle, { color: colors.warning }]}>
              Pro is temporarily unavailable
            </Text>
            <Text style={[styles.alertBody, { color: colors.textMuted }]}>
              The store did not return a subscription for your region right now. Please
              try again later.
            </Text>
          </View>
        ) : null}

        {isSimulated ? (
          <View style={[styles.devNotice, { borderColor: colors.warning }]}>
            <Text style={[styles.devNoticeText, { color: colors.warning }]}>
              Development mode: no RevenueCat key is configured, so purchases are simulated
              locally and no payment is taken.
            </Text>
          </View>
        ) : null}

        <Text style={[styles.smallPrint, { color: colors.textFaint }]}>
          {isPro
            ? 'Manage or cancel any time in the Google Play Store. Cancelling keeps Pro until the end of the period you have paid for.'
            : 'Billed monthly through Google Play. Cancel any time in your Play Store account settings.'}
        </Text>
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        {isPro ? (
          <PrimaryButton
            testID="manage-subscription"
            label="Manage Subscription"
            onPress={() => void handleManage()}
          />
        ) : (
          <PrimaryButton
            testID="upgrade-to-pro"
            label="Upgrade to Pro"
            caption={priceLabel ?? undefined}
            size="large"
            loading={busy === 'purchase' || priceState === 'loading'}
            // Nothing to buy if the store has no product for this customer.
            disabled={busy != null || priceUnavailable}
            onPress={() => void handlePurchase()}
          />
        )}

        <PrimaryButton
          testID="restore-purchases"
          label="Restore Purchases"
          variant="ghost"
          loading={busy === 'restore'}
          disabled={busy != null}
          onPress={() => void handleRestore()}
        />
      </View>
    </SafeAreaView>
  );
}

function ProHeader({
  status,
  expirationDate,
}: {
  status: SubscriptionStatus;
  expirationDate: string | null;
}) {
  const { colors } = useTheme();

  const { label, tone } = describeStatus(status);
  const renewalWord = status === 'cancelled' ? 'Access ends' : 'Renews';

  return (
    <View style={styles.proHeader}>
      <Text style={[styles.title, { color: colors.text }]}>You&apos;re on Pro</Text>
      <StatusBadge label={label} tone={tone} />
      {expirationDate ? (
        <Text style={[styles.renewal, { color: colors.textMuted }]}>
          {renewalWord} on {formatDate(expirationDate)}
        </Text>
      ) : null}
    </View>
  );
}

/** Explains anything the user needs to act on. Silent when all is well. */
function StatusDetail() {
  const { colors } = useTheme();
  const { status, subscription } = useSubscription();

  if (status === 'billingIssue') {
    return (
      <View style={[styles.alert, { borderColor: colors.danger }]}>
        <Text style={[styles.alertTitle, { color: colors.danger }]}>
          There is a problem with your payment
        </Text>
        <Text style={[styles.alertBody, { color: colors.textMuted }]}>
          Google could not take the last payment. Pro stays active for now, but it will
          end unless the payment method is updated in the Play Store.
        </Text>
      </View>
    );
  }

  if (status === 'cancelled') {
    return (
      <View style={[styles.alert, { borderColor: colors.warning }]}>
        <Text style={[styles.alertTitle, { color: colors.warning }]}>
          Auto-renew is off
        </Text>
        <Text style={[styles.alertBody, { color: colors.textMuted }]}>
          You keep every Pro feature until the end of the period you have already paid
          for. You can turn renewal back on in the Play Store.
        </Text>
      </View>
    );
  }

  if (subscription.isSandbox) {
    return (
      <View style={[styles.alert, { borderColor: colors.warning }]}>
        <Text style={[styles.alertBody, { color: colors.warning }]}>
          This is a test purchase from a Play licence-tester account.
        </Text>
      </View>
    );
  }

  return null;
}

function describeStatus(status: SubscriptionStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'active':
      return { label: 'Active', tone: 'active' };
    case 'cancelled':
      return { label: 'Ends soon', tone: 'warning' };
    case 'billingIssue':
      return { label: 'Payment problem', tone: 'danger' };
    case 'expired':
      return { label: 'Expired', tone: 'neutral' };
    case 'unknown':
      return { label: 'Checking…', tone: 'neutral' };
    default:
      return { label: 'Free', tone: 'neutral' };
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an unknown date';
  return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  title: typography.display,
  subtitleText: {
    ...typography.body,
    marginTop: -spacing.xs,
  },
  price: {
    ...typography.title,
    fontSize: 22,
    marginTop: -spacing.sm,
  },
  proHeader: {
    gap: spacing.sm,
  },
  renewal: typography.body,
  reason: {
    borderRadius: radius.md,
    padding: spacing.md,
  },
  reasonText: {
    ...typography.body,
    lineHeight: 21,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  check: {
    ...typography.label,
    fontSize: 16,
    width: 18,
  },
  benefit: {
    ...typography.body,
    flex: 1,
  },
  alert: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  alertTitle: {
    ...typography.label,
    fontSize: 15,
  },
  alertBody: {
    ...typography.caption,
    lineHeight: 19,
  },
  devNotice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  devNoticeText: {
    ...typography.caption,
    lineHeight: 18,
  },
  smallPrint: {
    ...typography.caption,
    lineHeight: 18,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
