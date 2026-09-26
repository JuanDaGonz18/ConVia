import { useEffect, useRef } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { Location } from '@/types';

type MapContainerProps = {
  /** Extra pins, e.g. departure points of available trips. */
  locations?: Location[];
  origin?: Location | null;
  destination?: Location | null;
  onSelectLocation?: (location: Location) => void;
  /** Called when the user taps the map (or a named place on it). */
  onMapPress?: (point: { latitude: number; longitude: number; name?: string }) => void;
  style?: StyleProp<ViewStyle>;
};

// Only used until the device location arrives.
const fallbackRegion: Region = {
  latitude: 4.711,
  longitude: -74.0721,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

export function MapContainer({ locations = [], origin, destination, onSelectLocation, onMapPress, style }: MapContainerProps) {
  const mapRef = useRef<MapView>(null);

  // Frame origin + destination, or center on whichever one is known.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = [origin, destination].filter((point): point is Location => !!point);
    if (points.length === 2) {
      map.fitToCoordinates(points, {
        edgePadding: { top: 80, right: 60, bottom: 260, left: 60 },
        animated: true,
      });
    } else if (points.length === 1) {
      map.animateToRegion({ ...points[0], latitudeDelta: 0.04, longitudeDelta: 0.04 }, 800);
    }
  }, [origin, destination]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        initialRegion={origin ? { ...origin, latitudeDelta: 0.04, longitudeDelta: 0.04 } : fallbackRegion}
        onPoiClick={onMapPress ? (event) => {
          const { coordinate, name } = event.nativeEvent;
          // Google adds extra lines (e.g. rating) after the place name.
          onMapPress({ ...coordinate, name: name.split('\n')[0].trim() });
        } : undefined}
        onPress={onMapPress ? (event) => {
          if (event.nativeEvent.action === 'marker-press') return;
          onMapPress(event.nativeEvent.coordinate);
        } : undefined}
        ref={mapRef}
        toolbarEnabled={false}
        showsCompass
        showsMyLocationButton
        showsUserLocation
        style={StyleSheet.absoluteFill}
      >
        {origin && destination ? (
          <Polyline
            coordinates={[origin, destination]}
            lineDashPattern={[8, 6]}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
        ) : null}

        {locations.map((location) => (
          <Marker
            coordinate={location}
            description={location.address}
            key={`pin-${location.id}`}
            onPress={() => onSelectLocation?.(location)}
            title={location.label}
          >
            <View style={[styles.marker, styles.tripMarker]}>
              <Ionicons color={colors.white} name="car" size={14} />
            </View>
          </Marker>
        ))}

        {origin ? (
          <Marker coordinate={origin} description={origin.address} title={origin.label}>
            <View style={[styles.marker, styles.originMarker]}>
              <Ionicons color={colors.white} name="navigate" size={16} />
            </View>
          </Marker>
        ) : null}

        {destination ? (
          <Marker coordinate={destination} description={destination.address} title={destination.label}>
            <View style={[styles.marker, styles.destinationMarker]}>
              <Ionicons color={colors.white} name="flag" size={16} />
            </View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E5EEF8',
    flex: 1,
    overflow: 'hidden',
  },
  marker: {
    alignItems: 'center',
    borderColor: colors.white,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    elevation: 4,
    height: 32,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    width: 32,
  },
  tripMarker: { backgroundColor: colors.primary },
  originMarker: { backgroundColor: '#10B981' },
  destinationMarker: { backgroundColor: '#EF4444' },
});
