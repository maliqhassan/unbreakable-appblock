import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { spacing, typography, useTheme } from '../constants/theme';
import type { NativeDiagnostics } from '../../modules/unbreakable-lock';
import { LockService } from '../services/LockService';
import { formatClockTime } from '../utils/time';

/**
 * Android enforcement diagnostics.
 *
 * Reachable in release builds too, from Account -> Troubleshooting.
 *
 * It exists because almost every Android enforcement bug is invisible from the
 * normal UI: the service quietly not running, a permission revoked, an OEM
 * killing the process. This shows the raw native truth, and it is what turns
 * "it doesn't work" into a report anyone can act on.
 *
 * It reports status only — no user data, no identifiers, nothing sensitive.
 */
interface Snapshot {
  data: NativeDiagnostics | null;
  error: string | null;
}

/** Never throws — a diagnostics screen that crashes is worse than useless. */
function readDiagnostics(): Snapshot {
  try {
    return { data: LockService.getDiagnostics(), error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Diagnostics are unavailable.',
    };
  }
}

export function DiagnosticsScreen() {
  const { colors } = useTheme();
  // Read once during initialisation rather than in an effect, so the first
  // paint already has real data instead of flashing empty.
  const [snapshot, setSnapshot] = useState(readDiagnostics);
  const { data, error } = snapshot;

  const refresh = useCallback(() => setSnapshot(readDiagnostics()), []);

  // One second, matching the native poll, so the remaining-time readout lines
  // up with what the service is actually seeing.
  useEffect(() => {
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (Platform.OS !== 'android') {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={[styles.note, { color: colors.textMuted }]}>
          These diagnostics cover the Android enforcement engine only.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Android diagnostics</Text>

        {error ? (
          <Text style={[styles.note, { color: colors.danger }]}>{error}</Text>
        ) : null}

        {data ? (
          <>
            <Card title="Device">
              <Row label="Android" value={`${data.androidRelease} (API ${data.sdkInt})`} />
              <Row label="Manufacturer" value={data.manufacturer} />
              <Row label="Model" value={data.model} />
            </Card>

            <Card title="Permissions">
              <BoolRow label="Usage access" value={data.permissions.usageAccess} />
              <BoolRow label="Overlay" value={data.permissions.overlay} />
              <BoolRow label="Notifications" value={data.permissions.notifications} />
              <BoolRow label="Battery unrestricted" value={data.permissions.batteryOptimization} />
              <BoolRow label="Accessibility" value={data.permissions.accessibility} />
              <Text style={[styles.note, { color: colors.textFaint }]}>
                Accessibility is always off: this app ships no AccessibilityService.
              </Text>
            </Card>

            <Card title="Enforcement">
              <BoolRow label="Native service running" value={data.serviceRunning} />
              <BoolRow label="Manual session active" value={data.sessionActive} />
              <BoolRow label="Effectively enforcing" value={data.effectiveActive} />
              <Row
                label="Sources"
                value={data.effectiveSources.join(', ') || 'none'}
              />
              <Row
                label="Blocked now"
                value={String(data.effectivePackages.length)}
              />
              {data.degradedReason ? (
                <Text style={[styles.note, { color: colors.danger }]}>
                  {data.degradedReason}
                </Text>
              ) : null}
            </Card>

            {data.sessionActive ? (
              <Card title="Session">
                <Row label="Id" value={data.sessionId || '—'} />
                <Row
                  label="Start"
                  value={data.startTimestamp > 0 ? formatClockTime(data.startTimestamp) : '—'}
                />
                <Row
                  label="End"
                  value={data.endTimestamp > 0 ? formatClockTime(data.endTimestamp) : '—'}
                />
                <Row label="Remaining" value={formatRemaining(data.remainingMs)} />
                <BoolRow label="Strict mode" value={data.strictMode} />
                <Text style={[styles.subheading, { color: colors.textMuted }]}>Targets</Text>
                {data.targets.length === 0 ? (
                  <Text style={[styles.mono, { color: colors.textFaint }]}>none</Text>
                ) : (
                  data.targets.map((pkg) => (
                    <Text key={pkg} style={[styles.mono, { color: colors.text }]}>
                      {pkg}
                    </Text>
                  ))
                )}
              </Card>
            ) : null}

            <Card title="Schedules">
              <Row label="Saved schedules" value={String(data.scheduleCount)} />
              <BoolRow label="Schedule running" value={data.scheduleActive} />
              <BoolRow label="Exact alarms allowed" value={data.canScheduleExactAlarms} />
              {!data.canScheduleExactAlarms ? (
                <Text style={[styles.note, { color: colors.warning }]}>
                  Without exact alarms, Doze can delay a schedule by several minutes.
                </Text>
              ) : null}
            </Card>

            <Card
              title="Never blocked"
              subtitle="Enforced natively so a lock can never strand you."
            >
              {data.protectedPackages.map((pkg) => (
                <Text key={pkg} style={[styles.mono, { color: colors.textMuted }]}>
                  {pkg}
                </Text>
              ))}
            </Card>
          </>
        ) : null}

        <PrimaryButton label="Refresh" variant="secondary" onPress={refresh} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function BoolRow({ label, value }: { label: string; value: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: value ? colors.success : colors.danger }]}>
        {value ? '✓ yes' : '✗ no'}
      </Text>
    </View>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  title: typography.title,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 3,
  },
  rowLabel: {
    ...typography.caption,
    flex: 1,
  },
  rowValue: {
    ...typography.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  subheading: {
    ...typography.caption,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  mono: {
    ...typography.caption,
    fontFamily: Platform.select({ android: 'monospace', default: 'monospace' }),
  },
  note: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
