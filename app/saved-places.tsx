import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { TextField } from '@/components/forms/TextField';
import { MapPickerModal } from '@/components/map/MapPickerModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { personalizationService } from '@/services/personalizationService';
import { usePlan } from '@/subscription/usePlan';
import { useAppStore } from '@/store/appStore';
import { Location, SavedPlace, SavedPlaceKind } from '@/types';
import { errorMessage } from '@/utils/format';

const FIXED_KINDS: SavedPlaceKind[] = ['home', 'work', 'university'];

const KIND_ICONS: Record<SavedPlaceKind, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  work: 'briefcase-outline',
  university: 'school-outline',
  other: 'location-outline',
};

/** What is being picked on the map: a new place or an existing one. */
type Editing = { kind: SavedPlaceKind; label: string; place?: SavedPlace };

export default function SavedPlacesScreen() {
  const { t } = useTranslation();
  /** Home, work and university are shown in the current language, whatever label was stored. */
  const nameOf = (kind: SavedPlaceKind, place?: SavedPlace) => (kind === 'other' && place ? place.label : t(`placeKinds.${kind}`));
  const places = useAppStore((state) => state.savedPlaces);
  const setSavedPlaces = useAppStore((state) => state.setSavedPlaces);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [newOtherName, setNewOtherName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SavedPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = places.filter((place) => place.kind === 'other');
  // Limit from the server (relaxed during the beta); the database enforces it too.
  const { limit, atLimit } = usePlan();
  const placeLimit = limit('saved_places');
  const full = atLimit('saved_places', places.length);

  const save = async (location: Location) => {
    if (!editing) return;
    const { kind, label, place } = editing;
    setEditing(null);
    setNewOtherName(null);
    setBusy(true);
    setError(null);
    try {
      const saved = await personalizationService.savePlace({ id: place?.id, kind, label, location });
      setSavedPlaces(place ? places.map((item) => (item.id === saved.id ? saved : item)) : [...places, saved]);
      toast.success(t('savedPlaces.saved', { name: nameOf(saved.kind, saved) }));
    } catch (saveError) {
      setError(errorMessage(saveError, t('savedPlaces.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (place: SavedPlace) => {
    setToDelete(null);
    setBusy(true);
    setError(null);
    try {
      await personalizationService.deletePlace(place.id);
      setSavedPlaces(places.filter((item) => item.id !== place.id));
      toast.info(t('savedPlaces.deleted', { name: nameOf(place.kind, place) }));
    } catch (deleteError) {
      setError(errorMessage(deleteError, t('savedPlaces.deleteFailed')));
    } finally {
      setBusy(false);
    }
  };

  const renderPlace = (kind: SavedPlaceKind, place: SavedPlace | undefined) => (
    <View key={place?.id ?? kind} style={styles.card}>
      <View style={styles.iconCircle}>
        <Ionicons color={colors.primary} name={KIND_ICONS[kind]} size={20} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{nameOf(kind, place)}</Text>
        <Text numberOfLines={2} style={styles.cardAddress}>{place ? place.address || t('savedPlaces.onMap') : t('savedPlaces.notSaved')}</Text>
      </View>
      {place ? (
        <View style={styles.cardActions}>
          <Pressable
            accessibilityLabel={t('savedPlaces.change', { name: nameOf(kind, place) })}
            disabled={busy}
            hitSlop={6}
            onPress={() => setEditing({ kind, label: nameOf(kind, place), place })}
            style={styles.iconButton}
          >
            <Ionicons color={colors.primary} name="create-outline" size={20} />
          </Pressable>
          <Pressable accessibilityLabel={t('savedPlaces.delete', { name: nameOf(kind, place) })} disabled={busy} hitSlop={6} onPress={() => setToDelete(place)} style={styles.iconButton}>
            <Ionicons color={colors.error} name="trash-outline" size={20} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityLabel={t('savedPlaces.addNamed', { name: nameOf(kind) })}
          disabled={busy || full}
          onPress={() => setEditing({ kind, label: nameOf(kind) })}
          style={[styles.addChip, full ? styles.disabled : null]}
        >
          <Ionicons color={colors.primary} name="add" size={16} />
          <Text style={styles.addChipText}>{t('savedPlaces.add')}</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker={t('savedPlaces.kicker')} title={t('savedPlaces.title')} />
        <Text style={styles.subtitle}>{t('savedPlaces.subtitle')}</Text>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {busy ? <ActivityIndicator color={colors.primary} /> : null}

        {FIXED_KINDS.map((kind) => renderPlace(kind, places.find((place) => place.kind === kind)))}

        <Text style={styles.section}>{t('savedPlaces.others')}</Text>
        {others.map((place) => renderPlace('other', place))}

        {newOtherName !== null ? (
          <View style={styles.newOther}>
            <TextField
              autoFocus
              error={nameError}
              label={t('savedPlaces.nameLabel')}
              maxLength={40}
              onChangeText={(text) => {
                setNewOtherName(text);
                setNameError(null);
              }}
              placeholder={t('savedPlaces.namePlaceholder')}
              value={newOtherName}
            />
            <ButtonPrimary
              onPress={() => {
                if (!newOtherName.trim()) {
                  setNameError(t('savedPlaces.nameRequired'));
                  return;
                }
                setEditing({ kind: 'other', label: newOtherName.trim() });
              }}
              title={t('savedPlaces.pickOnMap')}
            />
            <ButtonSecondary
              onPress={() => {
                setNewOtherName(null);
                setNameError(null);
              }}
              title={t('savedPlaces.cancel')}
            />
          </View>
        ) : (
          <ButtonSecondary disabled={busy || full} onPress={() => setNewOtherName('')} title={t('savedPlaces.addOther')} />
        )}
        {full && placeLimit !== null ? <Text style={styles.note}>{t('savedPlaces.limit', { count: placeLimit })}</Text> : null}
      </ScrollView>

      <MapPickerModal
        initial={editing?.place ?? null}
        onClose={() => setEditing(null)}
        onConfirm={(location) => void save(location)}
        title={editing ? t('savedPlaces.locationOf', { name: editing.label }) : ''}
        visible={editing !== null}
      />

      <ConfirmDialog
        cancelLabel={t('savedPlaces.back')}
        confirmLabel={t('savedPlaces.confirmDelete')}
        icon="trash-outline"
        tone="danger"
        message={t('savedPlaces.deleteText')}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && void remove(toDelete)}
        title={toDelete ? t('savedPlaces.deleteTitle', { name: nameOf(toDelete.kind, toDelete) }) : ''}
        visible={toDelete !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[12], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing[4] },
  section: { ...typography.headingM, color: colors.text, marginTop: spacing[12] },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  cardAddress: { ...typography.caption, color: colors.textSecondary },
  cardActions: { flexDirection: 'row', gap: spacing[4] },
  iconButton: { padding: spacing[8] },
  addChip: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  addChipText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  newOther: { backgroundColor: colors.white, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[16] },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
