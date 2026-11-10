import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { type FeedbackReport, feedbackService } from '@/services/feedbackService';
import { errorMessage, rawErrorMessage } from '@/utils/format';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  type FeedbackCategory,
  feedbackErrorKey,
  feedbackProblems,
} from '@/utils/feedback';

/** Report a bug or send a suggestion. Reports are private to the sender and the team. */
export default function FeedbackScreen() {
  const { t } = useTranslation();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ category?: string; description?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reports, setReports] = useState<FeedbackReport[]>([]);

  const loadReports = useCallback(() => {
    // The list is secondary; sending still works without it.
    void feedbackService.mine().then(setReports).catch(() => undefined);
  }, []);

  useEffect(loadReports, [loadReports]);

  const submit = async () => {
    const problems = feedbackProblems(category, description);
    setErrors({
      category: problems.includes('category') ? t('feedback.categoryRequired') : undefined,
      description: problems.includes('tooShort')
        ? t('feedback.tooShort', { min: FEEDBACK_MIN_LENGTH })
        : problems.includes('tooLong') ? t('feedback.tooLong', { max: FEEDBACK_MAX_LENGTH }) : undefined,
    });
    setError(null);
    if (problems.length || !category || sending) return;
    setSending(true);
    try {
      await feedbackService.submit(category, description);
      setCategory(null);
      setDescription('');
      toast.success(t('feedback.sent'));
      loadReports();
    } catch (submitError) {
      const key = feedbackErrorKey(rawErrorMessage(submitError));
      setError(key ? t(`feedback.errors.${key}`) : errorMessage(submitError, t('feedback.errors.generic')));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader kicker={t('feedback.kicker')} subtitle={t('feedback.subtitle')} title={t('feedback.title')} />

          <Text style={styles.label}>{t('feedback.category')}</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {FEEDBACK_CATEGORIES.map((option) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: category === option, selected: category === option }}
                key={option}
                onPress={() => { setCategory(option); setErrors((current) => ({ ...current, category: undefined })); }}
                style={[styles.chip, category === option && styles.chipSelected]}
              >
                <Text style={[styles.chipText, category === option && styles.chipTextSelected]}>{t(`feedback.categories.${option}`)}</Text>
              </Pressable>
            ))}
          </View>
          {errors.category ? <Text style={styles.error}>{errors.category}</Text> : null}

          <TextField
            error={errors.description}
            hint={t('feedback.counter', { count: description.length, max: FEEDBACK_MAX_LENGTH })}
            label={t('feedback.description')}
            maxLength={FEEDBACK_MAX_LENGTH + 200}
            multiline
            numberOfLines={6}
            onChangeText={(text) => { setDescription(text); setErrors((current) => ({ ...current, description: undefined })); }}
            placeholder={t('feedback.placeholder')}
            style={styles.textarea}
            textAlignVertical="top"
            value={description}
          />
          <Text style={styles.hint}>{t('feedback.privacy')}</Text>

          {error ? <Notice tone="error">{error}</Notice> : null}
          <ButtonPrimary loading={sending} onPress={() => void submit()} title={t('feedback.submit')} />

          <Text style={[styles.label, styles.mineTitle]}>{t('feedback.mine')}</Text>
          {reports.length === 0 ? <Text style={styles.hint}>{t('feedback.empty')}</Text> : null}
          {reports.map((report) => (
            <View key={report.id} style={styles.report}>
              <View style={styles.reportHeader}>
                <Text style={styles.reportCategory}>{t(`feedback.categories.${report.category}`)}</Text>
                <Text style={styles.reportStatus}>{t(`feedback.status.${report.status}`)}</Text>
              </View>
              <Text numberOfLines={3} style={styles.reportText}>{report.description}</Text>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  label: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  chip: { borderColor: colors.border, borderRadius: radius.radiusFull, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing[16] },
  chipSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { ...typography.bodySmall, color: colors.text },
  chipTextSelected: { color: colors.primary, fontWeight: '600' },
  textarea: { minHeight: 120 },
  error: { ...typography.caption, color: colors.error },
  hint: { ...typography.caption, color: colors.textSecondary },
  mineTitle: { marginTop: spacing[8] },
  report: { backgroundColor: colors.white, borderColor: colors.border, borderRadius: radius.radiusMedium, borderWidth: 1, gap: spacing[4], padding: spacing[12] },
  reportHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  reportCategory: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  reportStatus: { ...typography.caption, color: colors.primary },
  reportText: { ...typography.bodySmall, color: colors.textSecondary },
});
