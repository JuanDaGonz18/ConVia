import React, { useEffect, useRef, useState } from 'react';
import {
  DimensionValue,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { Location } from '@/types';

type MapContainerProps = {
  locations?: Location[];
  origin?: Location | null;
  destination?: Location | null;
  initialRegion?: Region;
  onSelectLocation?: (location: Location) => void;
  style?: StyleProp<ViewStyle>;
};

const defaultRegion: Region = {
  latitude: 4.711,
  longitude: -74.0721,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const defaultPositions: { top: DimensionValue; left: DimensionValue }[] = [
  { top: '15%', left: '38%' }, // Colina
  { top: '8%', left: '48%' },  // Santafe
  { top: '48%', left: '55%' }, // Parque 93
  { top: '35%', left: '60%' }, // Unicentro
  { top: '42%', left: '45%' }, // Calle 100
  { top: '65%', left: '20%' }, // Aeropuerto
];

export function MapContainer({
  locations = [],
  origin,
  destination,
  initialRegion = defaultRegion,
  onSelectLocation,
  style,
}: MapContainerProps) {
  const mapRef = useRef<MapView>(null);
  const [mapMode, setMapMode] = useState<'native' | 'interactive'>('native');

  // When origin or destination change, center and frame the map
  useEffect(() => {
    if (destination && mapRef.current) {
      if (origin) {
        mapRef.current.fitToCoordinates(
          [
            { latitude: origin.latitude, longitude: origin.longitude },
            { latitude: destination.latitude, longitude: destination.longitude },
          ],
          {
            edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
            animated: true,
          }
        );
      } else {
        mapRef.current.animateToRegion(
          {
            latitude: destination.latitude,
            longitude: destination.longitude,
            latitudeDelta: 0.04,
            longitudeDelta: 0.04,
          },
          800
        );
      }
    }
  }, [origin, destination]);

  const routeCoordinates = origin && destination
    ? [
        { latitude: origin.latitude, longitude: origin.longitude },
        // Add midpoint for smoother curved visual route on streets
        {
          latitude: (origin.latitude + destination.latitude) / 2 + 0.005,
          longitude: (origin.longitude + destination.longitude) / 2 - 0.004,
        },
        { latitude: destination.latitude, longitude: destination.longitude },
      ]
    : [];

  return (
    <View style={[styles.container, style]}>
      {mapMode === 'native' ? (
        <MapView
          initialRegion={initialRegion}
          ref={mapRef}
          showsCompass
          showsUserLocation={Platform.OS !== 'web'}
          style={styles.map}
        >
          {/* Route polyline */}
          {routeCoordinates.length > 0 ? (
            <Polyline
              coordinates={routeCoordinates}
              lineDashPattern={[1]}
              strokeColor={colors.primary}
              strokeWidth={5}
            />
          ) : null}

          {/* All location pins */}
          {locations.map((loc) => {
            const isOrigin = origin?.id === loc.id;
            const isDest = destination?.id === loc.id;

            return (
              <Marker
                coordinate={{
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                }}
                description={loc.address}
                key={loc.id}
                onPress={() => onSelectLocation?.(loc)}
                title={loc.label}
              >
                <View
                  style={[
                    styles.customMarker,
                    isDest
                      ? styles.destMarker
                      : isOrigin
                      ? styles.originMarker
                      : styles.defaultMarker,
                  ]}
                >
                  <Ionicons
                    color={colors.white}
                    name={
                      isDest
                        ? 'flag'
                        : isOrigin
                        ? 'navigate'
                        : 'location'
                    }
                    size={16}
                  />
                </View>
              </Marker>
            );
          })}
        </MapView>
      ) : (
        /* Fallback Interactive Vector Map for Bogotá (guaranteed to render on all phones) */
        <View style={styles.vectorMap}>
          {/* Grid lines and arterial avenues */}
          <View style={styles.avenueAutopista} />
          <View style={styles.avenueBoyaca} />
          <View style={styles.avenueCalle100} />
          <View style={styles.avenueCalle26} />
          <View style={styles.avenueSeptima} />

          <Text style={styles.avenueLabelNorte}>Autopista Norte</Text>
          <Text style={styles.avenueLabelCalle100}>Calle 100</Text>
          <Text style={styles.avenueLabelSeptima}>Carrera 7ma</Text>
          <Text style={styles.avenueLabelElDorado}>Av. El Dorado (Calle 26)</Text>

          {/* Route Line on vector map */}
          {origin && destination ? (
            <View style={styles.vectorRouteWrapper}>
              <View style={styles.vectorRouteLine} />
              <View style={styles.routeBadge}>
                <Ionicons color={colors.primary} name="car" size={14} />
                <Text style={styles.routeBadgeText}>Ruta Activa • 18 min</Text>
              </View>
            </View>
          ) : null}

          {/* Location markers on interactive map */}
          {locations.slice(0, 6).map((loc, idx) => {
            const isOrigin = origin?.id === loc.id;
            const isDest = destination?.id === loc.id;

            const pos = defaultPositions[idx] || { top: '30%', left: '40%' };

            return (
              <Pressable
                key={loc.id}
                onPress={() => onSelectLocation?.(loc)}
                style={[
                  styles.interactivePin,
                  { top: pos.top, left: pos.left },
                  isDest
                    ? styles.interactivePinDest
                    : isOrigin
                    ? styles.interactivePinOrigin
                    : null,
                ]}
              >
                <Ionicons
                  color={colors.white}
                  name={isDest ? 'flag' : isOrigin ? 'navigate' : 'location'}
                  size={16}
                />
                <View style={styles.pinLabelBox}>
                  <Text numberOfLines={1} style={styles.pinLabelText}>
                    {loc.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Floating controls */}
      <View style={styles.floatingControls}>
        <Pressable
          accessibilityLabel="Cambiar vista de mapa"
          onPress={() => setMapMode((prev) => (prev === 'native' ? 'interactive' : 'native'))}
          style={styles.modeToggleBtn}
        >
          <Ionicons
            color={colors.primary}
            name={mapMode === 'native' ? 'map' : 'globe-outline'}
            size={18}
          />
          <Text style={styles.modeToggleText}>
            {mapMode === 'native' ? 'Modo Vector' : 'Modo Nativo'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E5EEF8',
    flex: 1,
    overflow: 'hidden',
  },
  map: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  customMarker: {
    alignItems: 'center',
    borderRadius: radius.radiusFull,
    elevation: 4,
    height: 32,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    width: 32,
  },
  defaultMarker: {
    backgroundColor: colors.primary,
  },
  originMarker: {
    backgroundColor: '#10B981', // green
  },
  destMarker: {
    backgroundColor: '#EF4444', // red
  },
  floatingControls: {
    position: 'absolute',
    right: spacing[16],
    top: spacing[16],
    zIndex: 20,
  },
  modeToggleBtn: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    elevation: 4,
    flexDirection: 'row',
    gap: spacing[8],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  modeToggleText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  // Vector fallback map styles
  vectorMap: {
    backgroundColor: '#EEF3F8',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  avenueAutopista: {
    backgroundColor: '#CBD5E1',
    bottom: 0,
    left: '48%',
    position: 'absolute',
    top: 0,
    width: 14,
  },
  avenueBoyaca: {
    backgroundColor: '#D1D5DB',
    bottom: 0,
    left: '25%',
    position: 'absolute',
    top: 0,
    width: 10,
  },
  avenueCalle100: {
    backgroundColor: '#CBD5E1',
    height: 12,
    left: 0,
    position: 'absolute',
    right: 0,
    top: '44%',
  },
  avenueCalle26: {
    backgroundColor: '#CBD5E1',
    height: 12,
    left: 0,
    position: 'absolute',
    right: 0,
    top: '70%',
  },
  avenueSeptima: {
    backgroundColor: '#D1D5DB',
    bottom: 0,
    left: '70%',
    position: 'absolute',
    top: 0,
    width: 10,
  },
  avenueLabelNorte: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 10,
    left: '49%',
    position: 'absolute',
    top: '2%',
    transform: [{ rotate: '90deg' }],
  },
  avenueLabelCalle100: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 10,
    left: '10%',
    position: 'absolute',
    top: '41%',
  },
  avenueLabelSeptima: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 10,
    left: '71%',
    position: 'absolute',
    top: '20%',
    transform: [{ rotate: '90deg' }],
  },
  avenueLabelElDorado: {
    ...typography.caption,
    color: '#64748B',
    fontSize: 10,
    left: '10%',
    position: 'absolute',
    top: '67%',
  },
  interactivePin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    elevation: 6,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    width: 36,
  },
  interactivePinOrigin: {
    backgroundColor: '#10B981',
  },
  interactivePinDest: {
    backgroundColor: '#EF4444',
  },
  pinLabelBox: {
    backgroundColor: 'rgba(31,32,36,0.85)',
    borderRadius: radius.radiusSmall,
    bottom: -18,
    maxWidth: 90,
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: 'absolute',
  },
  pinLabelText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  vectorRouteWrapper: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  vectorRouteLine: {
    borderColor: colors.primary,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: 120,
    opacity: 0.8,
    transform: [{ rotate: '-35deg' }],
    width: 140,
  },
  routeBadge: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.primary,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    elevation: 3,
    flexDirection: 'row',
    gap: spacing[4],
    marginTop: spacing[8],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  routeBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
});
