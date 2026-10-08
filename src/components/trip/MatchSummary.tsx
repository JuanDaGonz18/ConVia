import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { describeReason, LEVEL_LABELS, MatchLevel, MatchReason, TripMatch } from '@/services/tripMatching';

const LEVEL_STYLE: Record<MatchLevel, { background: string; color: string }> = {
  excellent: { background: '#E8F7EF', color: '#067647' },
  good: { background: colors.primaryLight, color: colors.primary },
  fair: { background: '#FFF8EB', color: '#B54708' },
  low: { background: colors.lightGray, color: colors.textSecondary },
};

const REASON_ICONS: Record<MatchReason['kind'], keyof typeof Ionicons.glyphMap> = {
  same_destination: 'flag-outline',
  passes_destination: 'git-branch-outline',
  saved_place: 'bookmark-outline',
  leaves_near_you: 'walk-outline',
  passes_near_you: 'walk-outline',
  leaves_soon: 'time-outline',
  favorite_driver: 'star',
  pickup_on_route: 'walk-outline',
  dropoff_on_route: 'flag-outline',
};

/**
 * Why a trip (or a passenger's request) fits: the compatibility level and up
 * to three plain-language reasons. No scores or technical details.
 */
export function MatchSummary({ match, maxReasons = 3 }: Readonly<{ match: TripMatch; maxReasons?: number }>) {
  const level = LEVEL_STYLE[match.level];
  return (
    <View style={styles.container}>
      <View style={[styles.level, { backgroundColor: level.background }]}>
        <Text style={[styles.levelText, { color: level.color }]}>{LEVEL_LABELS[match.level]}</Text>
      </View>
      {match.reasons.slice(0, maxReasons).map((reason) => (
        <View key={reason.kind} style={styles.reason}>
          <Ionicons
            color={reason.kind === 'favorite_driver' ? colors.warning : colors.primary}
            name={REASON_ICONS[reason.kind]}
            size={14}
          />
          <Text style={styles.reasonText}>{describeReason(reason)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  level: { borderRadius: radius.radiusFull, paddingHorizontal: spacing[8], paddingVertical: 2 },
  levelText: { ...typography.caption, fontWeight: '700' },
  reason: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  reasonText: { ...typography.caption, color: colors.text, fontWeight: '600' },
});
