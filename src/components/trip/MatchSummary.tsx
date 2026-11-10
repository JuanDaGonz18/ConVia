import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { MatchLevel, MatchReason, TripMatch } from '@/services/tripMatching';
import { formatDistance } from '@/utils/format';

const LEVEL_STYLE: Record<MatchLevel, { background: string; color: string }> = {
  excellent: { background: colors.successLight, color: colors.successText },
  good: { background: colors.primaryLight, color: colors.primary },
  fair: { background: colors.warningLight, color: colors.warningText },
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

/** One reason in plain language (no technical details for users). */
function describeReason(t: TFunction, reason: MatchReason): string {
  const distance = 'km' in reason ? formatDistance(reason.km) : '';
  switch (reason.kind) {
    case 'same_destination':
      return reason.km < 0.3 ? t('match.reason.goesToDestination') : t('match.reason.arrivesNearDestination', { distance });
    case 'passes_destination':
      return t('match.reason.passesDestination', { distance });
    case 'saved_place':
      return reason.km < 0.3 ? t('match.reason.goesToPlace', { place: reason.label }) : t('match.reason.dropsNearPlace', { distance, place: reason.label });
    case 'leaves_near_you':
      return t('match.reason.leavesNearYou', { distance });
    case 'passes_near_you':
      return t('match.reason.passesNearYou', { distance });
    case 'leaves_soon':
      return reason.minutes <= 5 ? t('match.reason.leavesNow') : t('match.reason.leavesIn', { minutes: reason.minutes });
    case 'favorite_driver':
      return t('match.reason.favoriteDriver');
    case 'pickup_on_route':
      return reason.km < 0.1 ? t('match.reason.pickupOnRoute') : t('match.reason.pickupNearRoute', { distance });
    case 'dropoff_on_route':
      return reason.km < 0.1 ? t('match.reason.dropoffOnRoute') : t('match.reason.dropoffNearRoute', { distance });
  }
}

/**
 * Why a trip (or a passenger's request) fits: the compatibility level and up
 * to three plain-language reasons. No scores or technical details.
 */
export function MatchSummary({ match, maxReasons = 3 }: Readonly<{ match: TripMatch; maxReasons?: number }>) {
  const { t } = useTranslation();
  const level = LEVEL_STYLE[match.level];
  return (
    <View style={styles.container}>
      <View style={[styles.level, { backgroundColor: level.background }]}>
        <Text style={[styles.levelText, { color: level.color }]}>{t(`match.level.${match.level}`)}</Text>
      </View>
      {match.reasons.slice(0, maxReasons).map((reason) => (
        <View key={reason.kind} style={styles.reason}>
          <Ionicons
            color={reason.kind === 'favorite_driver' ? colors.warning : colors.primary}
            name={REASON_ICONS[reason.kind]}
            size={14}
          />
          <Text style={styles.reasonText}>{describeReason(t, reason)}</Text>
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
