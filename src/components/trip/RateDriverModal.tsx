import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/forms/TextField';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { StarRating } from '@/components/ui/StarRating';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

const SCORE_LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

export type RateDriverTarget = {
  tripId: string;
  tripLabel: string;
  driver: { name: string; avatarUrl?: string };
};

type RateDriverModalProps = Readonly<{
  target: RateDriverTarget | null;
  onClose: () => void;
  /** Called after the server saved the rating. */
  onRated: (tripId: string, score: number) => void;
}>;

/** The passenger rates the driver of a finished trip: stars plus an optional comment. */
export function RateDriverModal({ target, onClose, onRated }: RateDriverModalProps) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoreMissing, setScoreMissing] = useState(false);

  const close = () => {
    if (saving) return;
    setScore(0);
    setComment('');
    setError(null);
    setScoreMissing(false);
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    if (!score) {
      setScoreMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await tripService.rateDriver(target.tripId, score, comment.trim() || null);
      toast.success(`¡Gracias por calificar a ${target.driver.name}!`);
      onRated(target.tripId, score);
      setScore(0);
      setComment('');
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError, 'No se pudo guardar la calificación. Inténtalo de nuevo.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={close} statusBarTranslucent transparent visible={target !== null}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <Pressable accessibilityLabel="Cerrar" onPress={close} style={styles.overlay}>
          <Pressable onPress={() => undefined} style={styles.dialog}>
            {target ? (
              <>
                <Avatar imageUrl={target.driver.avatarUrl} name={target.driver.name} size={56} />
                <Text style={styles.title}>¿Cómo te fue con {target.driver.name}?</Text>
                <Text style={styles.trip}>{target.tripLabel}</Text>

                <View style={styles.stars}>
                  <StarRating
                    disabled={saving}
                    onChange={(value) => {
                      setScore(value);
                      setScoreMissing(false);
                    }}
                    score={score}
                    size={38}
                  />
                  <Text style={[styles.scoreLabel, scoreMissing ? styles.scoreMissing : null]}>
                    {scoreMissing ? 'Elige de 1 a 5 estrellas.' : SCORE_LABELS[score] || 'Toca una estrella'}
                  </Text>
                </View>

                <View style={styles.field}>
                  <TextField
                    hint="Opcional. Lo verá el conductor."
                    label="Comentario"
                    maxLength={500}
                    multiline
                    onChangeText={setComment}
                    placeholder="Cuéntanos cómo fue el viaje"
                    style={styles.comment}
                    value={comment}
                  />
                </View>

                {error ? <Notice tone="error">{error}</Notice> : null}

                <View style={styles.actions}>
                  <ButtonPrimary loading={saving} loadingTitle="Enviando…" onPress={() => void submit()} title="Enviar calificación" />
                  <ButtonSecondary disabled={saving} onPress={close} title="Ahora no" />
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing[24],
  },
  dialog: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    gap: spacing[8],
    maxWidth: 420,
    padding: spacing[24],
    width: '100%',
  },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  trip: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  stars: { alignItems: 'center', gap: spacing[4], marginVertical: spacing[8] },
  scoreLabel: { ...typography.bodyMedium, color: colors.textSecondary, fontWeight: '600' },
  scoreMissing: { color: colors.error },
  field: { alignSelf: 'stretch' },
  comment: { minHeight: 88, paddingVertical: spacing[12], textAlignVertical: 'top' },
  actions: { alignSelf: 'stretch', gap: spacing[8], marginTop: spacing[8] },
});
