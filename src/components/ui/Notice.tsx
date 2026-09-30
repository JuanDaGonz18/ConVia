import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

export type NoticeTone = 'error' | 'success' | 'info' | 'warning';

export const TONES: Record<NoticeTone, { background: string; border: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  error: { background: '#FEF3F2', border: '#FECDCA', color: '#B42318', icon: 'alert-circle' },
  success: { background: '#ECFDF3', border: '#ABEFC6', color: '#067647', icon: 'checkmark-circle' },
  info: { background: colors.primaryLight, border: '#C3DBFF', color: colors.primaryPressed, icon: 'information-circle' },
  warning: { background: '#FFFAEB', border: '#FEDF89', color: '#B54708', icon: 'warning' },
};

type NoticeProps = Readonly<{
  tone?: NoticeTone;
  title?: string;
  /** Plain text, or custom content (e.g. a list of missing fields). */
  children: ReactNode;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
}>;

/** Inline, human-readable feedback: what happened and, when possible, what to do next. */
export function Notice({ tone = 'info', title, children, action, onDismiss }: NoticeProps) {
  const palette = TONES[tone];
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      style={[styles.box, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      <Ionicons color={palette.color} name={palette.icon} size={20} style={styles.icon} />
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: palette.color }]}>{title}</Text> : null}
        {typeof children === 'string' ? <Text style={[styles.text, { color: palette.color }]}>{children}</Text> : children}
        {action ? (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={action.onPress}>
            <Text style={[styles.action, { color: palette.color }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable accessibilityLabel="Cerrar aviso" hitSlop={8} onPress={onDismiss}>
          <Ionicons color={palette.color} name="close" size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'flex-start',
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  icon: { marginTop: 1 },
  body: { flex: 1, gap: 4 },
  title: { ...typography.label },
  text: { ...typography.bodySmall },
  action: { ...typography.bodySmall, fontWeight: '700', textDecorationLine: 'underline' },
});
