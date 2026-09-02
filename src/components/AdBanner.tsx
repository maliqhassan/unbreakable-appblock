import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing, useTheme } from '../constants/theme';
import { useSubscription } from '../hooks/useSubscription';
import { AdService } from '../services/AdService';
import { log } from '../utils/logger';

/**
 * The free-tier banner.
 *
 * The entitlement check is *inside* this component on purpose. Callers cannot
 * forget it, and there is no prop that overrides it — a Pro user seeing an ad
 * would be a straightforward breach of what they paid for, so the guard is not
 * left to the call site.
 *
 * Never place this on the active lock screen, over the native block screen, or
 * in a permission flow: a stray tap there would interrupt enforcement, which is
 * the one thing the app must not let an ad do.
 */
export function AdBanner() {
  const { showAds, isLoading } = useSubscription();
  const { colors } = useTheme();
  const [ready, setReady] = useState(() => AdService.isReady());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!showAds || isLoading) return;
    let cancelled = false;

    void AdService.initialize().then(() => {
      if (!cancelled) setReady(AdService.isReady());
    });

    return () => {
      cancelled = true;
    };
  }, [showAds, isLoading]);

  // Do not reserve space while the entitlement is still unknown: a banner-sized
  // gap that then disappears for a Pro user is worse than a late-arriving ad.
  if (isLoading || !showAds || failed) return null;
  if (Platform.OS !== 'android') return null;
  if (!ready) return null;

  const banner = renderBanner(() => setFailed(true));
  if (!banner) return null;

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>{banner}</View>
  );
}

/**
 * Renders the native banner, or null when the SDK is absent.
 *
 * Kept out of the component body so a missing module is a null return rather
 * than a thrown import at render time.
 */
function renderBanner(onFail: () => void) {
  let sdk: typeof import('react-native-google-mobile-ads');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require('react-native-google-mobile-ads');
  } catch {
    return null;
  }

  const { BannerAd, BannerAdSize } = sdk;

  return (
    <BannerAd
      unitId={AdService.bannerUnitId()}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{
        // Keep the free tier as inoffensive as possible: no behavioural
        // targeting beyond what AdMob does by default.
        requestNonPersonalizedAdsOnly: true,
      }}
      onAdFailedToLoad={(error: unknown) => {
        // No fill is routine, not an error worth showing anyone.
        log.debug('Ads', 'Banner failed to load', error);
        onFail();
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.xs,
  },
});
