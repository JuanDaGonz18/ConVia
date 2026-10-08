import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { MapPickerModal } from '@/components/map/MapPickerModal';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService } from '@/services/locationService';
import { Location, SavedPlace, SavedPlaceKind } from '@/types';
import { errorMessage } from '@/utils/format';

type PlaceSearchFieldProps = {
  label?: string;
  placeholder?: string;
  value: Location | null;
  onChange: (location: Location | null) => void;
  /** Biases results toward this point (usually the user's position). */
  near?: Location | null;
  /** Shows a "use my current location" button. */
  allowCurrentLocation?: boolean;
  /** Title of the full-screen map picker. */
  mapTitle?: string;
  /** The user's saved places, offered as one-tap shortcuts while empty. */
  quickPlaces?: SavedPlace[];
  /**
   * When to offer the full-screen map picker: always ("Elegir en el mapa"),
   * only to fine-tune a chosen place ("Ajustar en el mapa"), or never (the
   * field already sits on a map).
   */
  mapLink?: 'always' | 'afterSelection' | 'never';
  /** 'bar': a single rounded search bar (for overlays on a map). */
  variant?: 'default' | 'bar';
  /** Shown at the start of the bar, e.g. a back button. */
  leading?: ReactNode;
  /** Validation message from the form: red border and the message under the field. */
  error?: string | null;
};

const QUICK_ICONS: Record<SavedPlaceKind, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  work: 'briefcase',
  university: 'school',
  other: 'bookmark',
};

/** Wait this long after the last keystroke before searching as you type. */
const TYPING_DELAY_MS = 700;

export function PlaceSearchField({
  label,
  placeholder = 'Busca una dirección o lugar',
  value,
  onChange,
  near,
  allowCurrentLocation = false,
  mapTitle,
  quickPlaces = [],
  mapLink = 'always',
  variant = 'default',
  leading,
  error: fieldError,
}: PlaceSearchFieldProps) {
  const bar = variant === 'bar';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'gps' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  // Only the newest search may update the results.
  const latestSearch = useRef(0);

  const search = async (text: string, fromTyping = false) => {
    if (text.trim().length < 3) {
      if (!fromTyping) setError('Escribe al menos 3 letras.');
      return;
    }
    const id = ++latestSearch.current;
    setBusy('search');
    setError(null);
    try {
      const found = await locationService.search(text, near ?? value);
      if (id !== latestSearch.current) return;
      setResults(found);
      if (!found.length) setError('No encontramos ese lugar. Prueba con más detalle o elígelo en el mapa.');
    } catch (searchError) {
      if (id === latestSearch.current) setError(errorMessage(searchError, 'No se pudo buscar el lugar.'));
    } finally {
      if (id === latestSearch.current) setBusy(null);
    }
  };

  // Search as you type, once the user pauses.
  useEffect(() => {
    if (query.trim().length < 3) return;
    const timer = setTimeout(() => void search(query, true), TYPING_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new query should trigger a search
  }, [query]);

  const pickCurrentLocation = async () => {
    setBusy('gps');
    setError(null);
    try {
      const current = await locationService.getCurrentLocation();
      onChange(current);
      setResults(null);
      setQuery('');
    } catch (gpsError) {
      setError(errorMessage(gpsError, 'No se pudo obtener tu ubicación.'));
    } finally {
      setBusy(null);
    }
  };

  const select = (location: Location) => {
    latestSearch.current += 1;
    onChange(location);
    setResults(null);
    setQuery('');
    setBusy(null);
  };

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {value ? (
        <View style={[styles.selected, bar ? styles.barSelected : null, fieldError ? styles.selectedError : null]}>
          {leading}
          <Ionicons color={colors.primary} name="location" size={18} />
          <View style={styles.selectedText}>
            <Text numberOfLines={1} style={styles.selectedLabel}>{value.label}</Text>
            <Text numberOfLines={bar ? 1 : 2} style={styles.selectedAddress}>{value.address}</Text>
          </View>
          <Pressable accessibilityLabel="Cambiar lugar" hitSlop={8} onPress={() => onChange(null)}>
            <Ionicons color={colors.textSecondary} name="close-circle" size={20} />
          </Pressable>
        </View>
      ) : bar ? (
        // One rounded bar: [leading] [text field] [search]
        <View style={[styles.bar, fieldError ? styles.boxError : null]}>
          {leading}
          <TextInput
            onChangeText={(text) => {
              setQuery(text);
              setResults(null);
              if (error) setError(null);
            }}
            onSubmitEditing={() => void search(query)}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            style={styles.barInput}
            value={query}
          />
          <Pressable accessibilityLabel="Buscar lugar" disabled={busy !== null} hitSlop={6} onPress={() => void search(query)} style={styles.barIcon}>
            {busy === 'search' ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons color={colors.primary} name="search" size={20} />}
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            onChangeText={(text) => {
              setQuery(text);
              setResults(null);
              if (error) setError(null);
            }}
            onSubmitEditing={() => void search(query)}
            placeholder={placeholder}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            style={[styles.input, fieldError ? styles.boxError : null]}
            value={query}
          />
          <Pressable
            accessibilityLabel="Buscar lugar"
            disabled={busy !== null}
            onPress={() => void search(query)}
            style={styles.iconButton}
          >
            {busy === 'search' ? <ActivityIndicator color={colors.white} /> : <Ionicons color={colors.white} name="search" size={18} />}
          </Pressable>
        </View>
      )}

      {fieldError ? (
        <View style={styles.errorRow}>
          <Ionicons color={colors.error} name="alert-circle" size={14} />
          <Text style={styles.errorText}>{fieldError}</Text>
        </View>
      ) : null}

      {!value && quickPlaces.length ? (
        <ScrollView
          contentContainerStyle={styles.quickRow}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.quickScroll}
        >
          {quickPlaces.map((place) => (
            <Pressable
              accessibilityLabel={`Usar ${place.label}`}
              key={place.id}
              onPress={() => select({ ...place, id: `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}` })}
              style={({ pressed }) => [styles.quickChip, pressed ? styles.quickChipPressed : null]}
            >
              <Ionicons color={colors.primary} name={QUICK_ICONS[place.kind]} size={14} />
              <Text numberOfLines={1} style={styles.quickText}>{place.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.links}>
        {allowCurrentLocation && !value ? (
          <Pressable disabled={busy !== null} onPress={() => void pickCurrentLocation()} style={styles.gpsButton}>
            {busy === 'gps' ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons color={colors.primary} name="navigate" size={16} />}
            <Text style={styles.gpsText}>Usar mi ubicación actual</Text>
          </Pressable>
        ) : null}
        {mapLink === 'always' || (mapLink === 'afterSelection' && value) ? (
          <Pressable onPress={() => setShowMap(true)} style={styles.gpsButton}>
            <Ionicons color={colors.primary} name="map-outline" size={16} />
            <Text style={styles.gpsText}>{value ? 'Ajustar en el mapa' : 'Elegir en el mapa'}</Text>
          </Pressable>
        ) : null}
      </View>

      <MapPickerModal
        initial={value}
        near={near}
        onClose={() => setShowMap(false)}
        onConfirm={(location) => {
          setShowMap(false);
          select(location);
        }}
        title={mapTitle ?? label ?? 'Elige el lugar'}
        visible={showMap}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {results?.length ? (
        <View style={styles.results}>
          {results.map((result) => (
            <Pressable key={result.id} onPress={() => select(result)} style={styles.resultItem}>
              <Ionicons color={colors.primary} name="location-outline" size={18} />
              <View style={styles.selectedText}>
                <Text numberOfLines={1} style={styles.selectedLabel}>{result.label}</Text>
                <Text numberOfLines={2} style={styles.selectedAddress}>{result.address}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[8] },
  label: { ...typography.label, color: colors.text },
  inputRow: { flexDirection: 'row', gap: spacing[8] },
  input: {
    ...typography.body,
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    height: 48,
    paddingHorizontal: spacing[12],
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusMedium,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[16] },
  bar: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[4],
    height: 50,
    paddingHorizontal: spacing[4],
  },
  barInput: { ...typography.body, color: colors.text, flex: 1, height: 48, paddingHorizontal: spacing[4] },
  barIcon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  barSelected: { borderColor: colors.primary, borderRadius: radius.radiusFull, borderWidth: 1, paddingHorizontal: spacing[4], paddingVertical: 6 },
  quickScroll: { flexGrow: 0 },
  quickRow: { gap: spacing[8] },
  quickChip: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: 4,
    height: 32,
    maxWidth: 180,
    paddingHorizontal: spacing[12],
  },
  quickChipPressed: { backgroundColor: '#D1E4FF' },
  quickText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  gpsButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing[8], paddingVertical: spacing[4] },
  gpsText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  selected: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  selectedText: { flex: 1, gap: 2 },
  selectedLabel: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  selectedAddress: { ...typography.caption, color: colors.textSecondary },
  results: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
  },
  resultItem: {
    alignItems: 'center',
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  error: { ...typography.caption, color: colors.error },
  // Same invalid look as TextField.
  boxError: { backgroundColor: '#FFFBFA', borderColor: colors.error },
  selectedError: { borderColor: colors.error, borderWidth: 1 },
  errorRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },
});
