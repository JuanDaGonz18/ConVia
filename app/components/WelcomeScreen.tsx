import React from 'react';
import { View, StyleSheet, Image, ActivityIndicator } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

// Props allow the parent to inform about reduced‑motion preferences.
interface WelcomeScreenProps {
  reduceMotion?: boolean;
}

// Decorative blue curves (top‑left & bottom‑right) using SVG.
const BlueCurves = () => (
  <Svg width="100%" height="100%" viewBox="0 0 400 400" style={StyleSheet.absoluteFill}>
    <Defs>
      <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#006FFF" />
        <Stop offset="1" stopColor="#00B8FF" />
      </LinearGradient>
    </Defs>
    {/* Top‑left curve */}
    <Path d="M0,120 C80,0 160,0 240,120" stroke="url(#grad)" strokeWidth={30} fill="none" />
    {/* Bottom‑right curve */}
    <Path d="M400,280 C320,400 240,400 160,280" stroke="url(#grad)" strokeWidth={30} fill="none" />
  </Svg>
);

// Minimal car illustration – body, roof, wheels and two passenger circles.
const CarIllustration = () => (
  <Svg width={200} height={120} viewBox="0 0 200 120">
    {/* Body */}
    <Path d="M20 80 L180 80 L170 50 L30 50 Z" fill="#006FFF" />
    {/* Roof */}
    <Path d="M60 50 L80 30 L120 30 L140 50 Z" fill="#006FFF" />
    {/* Wheels */}
    <Path d="M50 80 a10 10 0 1 0 0.1 0" fill="#000" />
    <Path d="M150 80 a10 10 0 1 0 0.1 0" fill="#000" />
    {/* Passengers */}
    <Path d="M70 55 a5 5 0 1 0 0.1 0" fill="#FFF" />
    <Path d="M110 55 a5 5 0 1 0 0.1 0" fill="#FFF" />
  </Svg>
);

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ reduceMotion = false }) => {
  // reduceMotion currently unused – reserved for future accessibility handling.
  return (
    <View style={styles.container} pointerEvents="none">
      <BlueCurves />
      <Image source={require('../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
      <View style={styles.carWrapper}>
        <CarIllustration />
      </View>
      <ActivityIndicator size="large" color="#006FFF" style={styles.loader} />
    </View>
  );
};

export default WelcomeScreen;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  carWrapper: {
    marginTop: 16,
  },
  loader: {
    marginTop: 24,
  },
});