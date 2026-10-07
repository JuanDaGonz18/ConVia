import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { AppMap, LatLng, MapHandle, MapRegion } from '@/maps';
import { locationService } from '@/services/locationService';
import { Location } from '@/types';

type MapPickerModalProps = Readonly<{
  visible: boolean;
  title: string;
  /** Where the map opens: the current value, else `near`, else Bogotá. */
  initial?: Location | null;
  near?: Location | null;
  onConfirm: (location: Location) => void;
  onClose: () => void;
}>;

const DEFAULT_REGION: MapRegion = { latitude: 4.711, longitude: -74.0721, latitudeDelta: 0.12, longitudeDelta: 0.12 };
const ZOOMED = { latitudeDelta: 0.012, longitudeDelta: 0.012 };
/** The map settling this close (km) to a chosen point keeps that point and its name. */
const SAME_SPOT_KM = 0.015;

/**
 * Full-screen picker: move the map under the center pin, tap any point or
 * named place, or search, then confirm. The confirmed point carries its real
 * coordinates and a reverse-geocoded address.
 */
export function MapPickerModal({ visible, title, initial, near, onConfirm, onClose }: MapPickerModalProps) {
  const mapRef = useRef<MapHandle>(null);
  const start = initial ?? near;
  const [point, setPoint] = useState<Location | null>(null);
  const [resolving, setResolving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Name of a tapped place, kept until the map settles on it.
  const pendingName = useRef<string | null>(null);
  // A point chosen by name (initial value or search result): while the map rests
  // on it, keep its name instead of replacing it with the street address.
  const keepAt = useRef<LatLng | null>(null);
  const lookup = useRef(0);

  useEffect(() => {
    if (!visible) return;
    keepAt.current = initial ?? null;
    const timer = setTimeout(() => {
      setPoint(initial ?? null);
      setQuery('');
      setResults(null);
      setSearchError(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [initial, visible]);

  const resolve = async (latitude: number, longitude: number) => {
    const id = ++lookup.current;
    const name = pendingName.current ?? undefined;
    pendingName.current = null;
    setResolving(true);
    try {
      const location = await locationService.fromCoordinate(latitude, longitude, name);
      if (id === lookup.current) setPoint(location);
    } finally {
      if (id === lookup.current) setResolving(false);
    }
  };

  const moveTo = (latitude: number, longitude: number, name?: string) => {
    pendingName.current = name ?? null;
    keepAt.current = null;
    mapRef.current?.centerOn({ latitude, longitude }, { delta: ZOOMED.latitudeDelta, duration: 400 });
  };

  const search = async () => {
    if (query.trim().length < 3) {
      setSearchError('Escribe al menos 3 letras.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const found = await locationService.search(query, near ?? point);
      setResults(found);
      if (!found.length) setSearchError('No encontramos ese lugar. Prueba con otro nombre o toca el mapa.');
    } catch {
      setSearchError('No se pudo buscar. Revisa tu conexión o toca el mapa.');
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (location: Location) => {
    setResults(null);
    setQuery('');
    lookup.current += 1; // ignore any lookup still running
    setPoint(location);
    pendingName.current = null;
    keepAt.current = location;
    mapRef.current?.centerOn(location, { delta: ZOOMED.latitudeDelta, duration: 400 });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <View style={styles.root}>
        <AppMap
          initialRegion={start ? { latitude: start.latitude, longitude: start.longitude, ...ZOOMED } : DEFAULT_REGION}
          onPress={(event) => moveTo(event.latitude, event.longitude, event.placeName)}
          onRegionChangeComplete={(center) => {
            if (keepAt.current && locationService.distanceKm(center, keepAt.current) < SAME_SPOT_KM) return;
            keepAt.current = null;
            void resolve(center.latitude, center.longitude);
          }}
          ref={mapRef}
          showsUserLocation
          style={StyleSheet.absoluteFill}
        />

        {/* Fixed pin: the selected point is always the center of the map. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <Ionicons color="#EF4444" name="location" size={44} style={styles.pin} />
        </View>

        <SafeAreaView edges={['top']} style={styles.top}>
          <View style={styles.header}>
            <Pressable accessibilityLabel="Cerrar mapa" hitSlop={8} onPress={onClose} style={styles.close}>
              <Ionicons color={colors.text} name="arrow-back" size={22} />
            </Pressable>
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
          </View>
          <View style={styles.searchRow}>
            <TextInput
              onChangeText={(text) => {
                setQuery(text);
                setResults(null);
                setSearchError(null);
              }}
              onSubmitEditing={() => void search()}
              placeholder="Buscar un lugar o dirección"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              style={styles.input}
              value={query}
            />
            <Pressable accessibilityLabel="Buscar" disabled={searching} onPress={() => void search()} style={styles.searchButton}>
              {searching ? <ActivityIndicator color={colors.white} /> : <Ionicons color={colors.white} name="search" size={18} />}
            </Pressable>
          </View>
          {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
          {results?.length ? (
            <View style={styles.results}>
              {results.map((result) => (
                <Pressable key={result.id} onPress={() => chooseResult(result)} style={styles.result}>
                  <Ionicons color={colors.primary} name="location-outline" size={18} />
                  <View style={styles.resultText}>
                    <Text numberOfLines={1} style={styles.resultLabel}>{result.label}</Text>
                    <Text numberOfLines={1} style={styles.resultAddress}>{result.address}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </SafeAreaView>

        <SafeAreaView edges={['bottom']} style={styles.bottom}>
          <Text style={styles.hint}>Mueve el mapa o tócalo para ubicar el punto exacto.</Text>
          <View style={styles.pointCard}>
            {resolving ? <ActivityIndicator color={colors.primary} /> : <Ionicons color="#EF4444" name="location" size={22} />}
            <View style={styles.resultText}>
              <Text numberOfLines={1} style={styles.resultLabel}>{point?.label ?? 'Elige un punto en el mapa'}</Text>
              {point ? <Text numberOfLines={2} style={styles.resultAddress}>{point.address}</Text> : null}
            </View>
          </View>
          <ButtonPrimary disabled={!point || resolving} onPress={() => point && onConfirm(point)} title="Confirmar ubicación" />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#E5EEF8', flex: 1 },
  pinWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  // The tip of the icon marks the point, so lift it by half its height.
  pin: { marginBottom: 44 },
  top: { gap: spacing[8], left: 0, paddingHorizontal: spacing[16], position: 'absolute', right: 0, top: 0 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    marginTop: spacing[8],
    padding: spacing[8],
  },
  close: { padding: spacing[4] },
  title: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: spacing[8] },
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
  searchButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusMedium,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  searchError: { ...typography.caption, backgroundColor: colors.white, color: colors.error, padding: spacing[8] },
  results: { backgroundColor: colors.white, borderRadius: radius.radiusMedium },
  result: {
    alignItems: 'center',
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  resultText: { flex: 1, gap: 2 },
  resultLabel: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  resultAddress: { ...typography.caption, color: colors.textSecondary },
  bottom: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.radiusLarge,
    borderTopRightRadius: radius.radiusLarge,
    bottom: 0,
    gap: spacing[12],
    left: 0,
    padding: spacing[16],
    position: 'absolute',
    right: 0,
  },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  pointCard: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
});
