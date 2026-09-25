import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { MapContainer } from '@/components/map/MapContainer';
import { TripCard } from '@/components/trip/TripCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { mockLocations } from '@/data/mock/locations';
import { mockTrips } from '@/data/mock/trips';
import { useAppStore } from '@/store/appStore';
import { Location, Trip } from '@/types';

export default function HomeScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const role = currentUser?.role ?? 'client';

  const originLocation: Location = mockLocations[0]; // Colina Campestre
  const [selectedDestination, setSelectedDestination] = useState<Location>(
    mockLocations[2] // Parque 93
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);
  const [booked, setBooked] = useState(false);

  // Search results filtering
  const searchResults = mockLocations.filter((loc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      loc.label.toLowerCase().includes(q) ||
      loc.address.toLowerCase().includes(q)
    );
  });

  const handleSelectDestination = (loc: Location) => {
    setSelectedDestination(loc);
    setSearchQuery(loc.label);
    setIsSearching(false);
    setBooked(false);
  };

  // Dynamic trip based on chosen destination
  const activeTrip: Trip = {
    ...mockTrips[0],
    origin: originLocation,
    destination: selectedDestination,
    price: selectedDestination.id === mockLocations[5].id ? 22000 : 12000,
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      {/* Top Header & Search Bar */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <View>
            <Text style={styles.greeting}>
              Hola, {currentUser?.name || 'Usuario'}
            </Text>
            <Text style={styles.currentOrigin}>
              📍 Salida: {originLocation.label}
            </Text>
          </View>
          <View style={styles.roleBadge}>
            <Ionicons
              color={colors.primary}
              name={role === 'driver' ? 'car-sport' : 'person'}
              size={14}
            />
            <Text style={styles.roleBadgeText}>
              {role === 'driver' ? 'Conductor' : 'Pasajero'}
            </Text>
          </View>
        </View>

        {/* Search Bar Input with Icon and Clear */}
        <View style={styles.searchBarWrapper}>
          <Ionicons
            color={colors.textSecondary}
            name="search-outline"
            size={20}
            style={styles.searchIcon}
          />
          <TextInput
            onBlur={() => {
              // slight delay to allow press event on search results
              setTimeout(() => setIsSearching(false), 200);
            }}
            onChangeText={(text) => {
              setSearchQuery(text);
              setIsSearching(true);
            }}
            onFocus={() => setIsSearching(true)}
            placeholder="¿A dónde vas en Bogotá? (Ej. Unicentro, 93)"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
            value={searchQuery}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => {
                setSearchQuery('');
                setIsSearching(true);
              }}
              style={styles.clearBtn}
            >
              <Ionicons color={colors.textSecondary} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Predictive Destination Search Dropdown */}
      {isSearching ? (
        <View style={styles.searchDropdown}>
          <Text style={styles.dropdownTitle}>Destinos Sugeridos en Bogotá</Text>
          <FlatList
            data={searchResults}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectDestination(item)}
                style={styles.searchResultItem}
              >
                <View style={styles.resultIconBox}>
                  <Ionicons color={colors.primary} name="location" size={18} />
                </View>
                <View style={styles.resultTextBox}>
                  <Text style={styles.resultLabel}>{item.label}</Text>
                  <Text numberOfLines={1} style={styles.resultAddress}>
                    {item.address}
                  </Text>
                </View>
                <Ionicons
                  color={colors.border}
                  name="arrow-forward"
                  size={16}
                />
              </Pressable>
            )}
            style={styles.searchResultsList}
          />
        </View>
      ) : null}

      {/* Interactive Map View with Route */}
      <View style={styles.mapWrapper}>
        <MapContainer
          destination={selectedDestination}
          locations={mockLocations}
          onSelectLocation={(loc) => handleSelectDestination(loc)}
          origin={originLocation}
        />
      </View>

      {/* Bottom Floating Info Card */}
      <View
        style={[
          styles.bottomCard,
          isCardCollapsed ? styles.bottomCardCollapsed : null,
        ]}
      >
        {/* Toggle Collapse Bar */}
        <Pressable
          onPress={() => setIsCardCollapsed(!isCardCollapsed)}
          style={styles.collapseBar}
        >
          <View style={styles.dragHandle} />
          <View style={styles.collapseHeaderRow}>
            <Text style={styles.collapseTitle}>
              {role === 'driver'
                ? 'Panel de Conductor'
                : `Destino: ${selectedDestination.label}`}
            </Text>
            <Ionicons
              color={colors.textSecondary}
              name={isCardCollapsed ? 'chevron-up' : 'chevron-down'}
              size={20}
            />
          </View>
        </Pressable>

        {/* Card Body if expanded */}
        {!isCardCollapsed ? (
          role === 'driver' ? (
            <View style={styles.driverSection}>
              <View style={styles.driverStatusRow}>
                <View style={styles.onlineIndicator} />
                <Text style={styles.driverStatusText}>Modo Conductor Activo</Text>
              </View>
              <Text style={styles.driverSubtext}>
                Hay 2 pasajeros buscando viaje hacia {selectedDestination.label}
              </Text>
              <View style={styles.buttonRow}>
                <ButtonPrimary
                  onPress={() => alert('Ruta compartida publicada con éxito')}
                  title="Publicar Cupos Disponibles"
                />
                <ButtonSecondary
                  onPress={() => router.push('/(tabs)/chats')}
                  title="Abrir Chats con Pasajeros"
                />
              </View>
            </View>
          ) : (
            <View style={styles.clientSection}>
              <View style={styles.routeQuickInfo}>
                <View style={styles.infoBadge}>
                  <Ionicons color={colors.primary} name="time-outline" size={14} />
                  <Text style={styles.infoBadgeText}>~20 min</Text>
                </View>
                <View style={styles.infoBadge}>
                  <Ionicons color={colors.primary} name="car-outline" size={14} />
                  <Text style={styles.infoBadgeText}>7.8 km</Text>
                </View>
                <View style={styles.infoBadge}>
                  <Ionicons color={colors.primary} name="people-outline" size={14} />
                  <Text style={styles.infoBadgeText}>2 cupos libres</Text>
                </View>
              </View>

              <TripCard trip={activeTrip} />

              <View style={styles.actionButtonsRow}>
                <View style={styles.reserveBtnWrapper}>
                  <ButtonPrimary
                    disabled={booked}
                    onPress={() => setBooked(true)}
                    title={
                      booked
                        ? '¡Viaje reservado!'
                        : `Reservar cupo ($${activeTrip.price.toLocaleString('es-CO')})`
                    }
                  />
                </View>
                <Pressable
                  accessibilityLabel="Chatear con conductor"
                  onPress={() => router.push('/(tabs)/chats')}
                  style={styles.chatIconButton}
                >
                  <Ionicons
                    color={colors.primary}
                    name="chatbubbles"
                    size={22}
                  />
                </Pressable>
              </View>
            </View>
          )
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[12],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[12],
    zIndex: 10,
  },
  userInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greeting: {
    ...typography.headingM,
    color: colors.text,
  },
  currentOrigin: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleBadge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  roleBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  searchBarWrapper: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flexDirection: 'row',
    height: dimensions.controlHeight,
    paddingHorizontal: spacing[12],
  },
  searchIcon: {
    marginRight: spacing[8],
  },
  searchInput: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  clearBtn: {
    padding: spacing[4],
  },
  searchDropdown: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: radius.radiusLarge,
    borderBottomRightRadius: radius.radiusLarge,
    elevation: 12,
    left: 0,
    maxHeight: 280,
    position: 'absolute',
    right: 0,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    top: 125,
    zIndex: 99,
  },
  dropdownTitle: {
    ...typography.caption,
    backgroundColor: colors.background,
    color: colors.textSecondary,
    fontWeight: '700',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
    textTransform: 'uppercase',
  },
  searchResultsList: {
    maxHeight: 240,
  },
  searchResultItem: {
    alignItems: 'center',
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  resultIconBox: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  resultTextBox: {
    flex: 1,
    gap: 2,
  },
  resultLabel: {
    ...typography.bodyMedium,
    color: colors.text,
    fontWeight: '600',
  },
  resultAddress: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  mapWrapper: {
    flex: 1,
  },
  bottomCard: {
    backgroundColor: colors.white,
    borderTopColor: colors.lightGray,
    borderTopLeftRadius: radius.radiusXL,
    borderTopRightRadius: radius.radiusXL,
    borderTopWidth: 1,
    bottom: dimensions.bottomNavigationHeight,
    elevation: 8,
    left: 0,
    paddingHorizontal: spacing[16],
    paddingTop: spacing[8],
    paddingBottom: spacing[16],
    position: 'absolute',
    right: 0,
    shadowColor: colors.shadow,
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  bottomCardCollapsed: {
    paddingBottom: spacing[8],
  },
  collapseBar: {
    alignItems: 'center',
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  dragHandle: {
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  collapseHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  collapseTitle: {
    ...typography.label,
    color: colors.text,
  },
  routeQuickInfo: {
    flexDirection: 'row',
    gap: spacing[8],
    marginBottom: spacing[8],
  },
  infoBadge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[12],
    paddingVertical: 4,
  },
  infoBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  clientSection: {
    gap: spacing[8],
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: spacing[12],
    marginTop: spacing[4],
  },
  reserveBtnWrapper: {
    flex: 1,
  },
  chatIconButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    height: dimensions.controlHeight,
    justifyContent: 'center',
    width: dimensions.controlHeight,
  },
  driverSection: {
    gap: spacing[12],
  },
  driverStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[8],
  },
  onlineIndicator: {
    backgroundColor: '#22C55E',
    borderRadius: radius.radiusFull,
    height: 10,
    width: 10,
  },
  driverStatusText: {
    ...typography.label,
    color: colors.text,
  },
  driverSubtext: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  buttonRow: {
    gap: spacing[8],
  },
});
