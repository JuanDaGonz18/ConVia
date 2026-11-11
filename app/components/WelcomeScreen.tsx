import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Image, ActivityIndicator, Animated } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface WelcomeScreenProps {
  reduceMotion?: boolean;
  onAnimationComplete?: () => void;
}

// Decorative blue curves (top-left & bottom-right) using SVG.
const BlueCurves = () => (
  <Svg width="100%" height="100%" viewBox="0 0 400 400" style={StyleSheet.absoluteFill}>
    <Defs>
      <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#006FFF" />
        <Stop offset="1" stopColor="#00B8FF" />
      </LinearGradient>
    </Defs>
    {/* Top-left curve */}
    <Path d="M0,120 C80,0 160,0 240,120" stroke="url(#grad)" strokeWidth={30} fill="none" />
    {/* Bottom-right curve */}
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

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  reduceMotion = false,
  onAnimationComplete,
}) => {
  const [containerOpacity] = useState(() => new Animated.Value(1));
  const [contentOpacity] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const [carTranslateX] = useState(() => new Animated.Value(reduceMotion ? 0 : -30));

  // Safeguard: keep track of whether completion has already been triggered
  const completedRef = useRef(false);
  const onAnimationCompleteRef = useRef(onAnimationComplete);

  useEffect(() => {
    onAnimationCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => {
    const notifyCompletion = () => {
      if (!completedRef.current) {
        completedRef.current = true;
        onAnimationCompleteRef.current?.();
      }
    };

    // Hard fallback safety timeout: ensures WelcomeScreen NEVER blocks the app indefinitely
    const fallbackTimer = setTimeout(() => {
      notifyCompletion();
    }, 3000);

    if (reduceMotion) {
      // Immediate presentation if reduced motion is requested
      const timer = setTimeout(() => {
        notifyCompletion();
      }, 800);
      return () => {
        clearTimeout(timer);
        clearTimeout(fallbackTimer);
      };
    }

    // Sequence: Fade in logo, curves & car slide in -> hold -> Fade out overlay smoothly
    const animation = Animated.sequence([
      // 1. Entrada suave (450ms)
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(carTranslateX, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
      // 2. Tiempo de lectura perceptible (650ms)
      Animated.delay(650),
      // 3. Salida suave (fade-out) hacia la app (350ms)
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]);

    animation.start(() => {
      notifyCompletion();
    });

    return () => {
      clearTimeout(fallbackTimer);
      animation.stop();
    };
  }, [reduceMotion, containerOpacity, contentOpacity, carTranslateX]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerOpacity,
        },
      ]}
      pointerEvents="none">
      {/* Curvas decorativas de fondo */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}>
        <BlueCurves />
      </Animated.View>

      {/* Contenido principal: Logotipo grande */}
      <Animated.View
        style={[
          styles.contentWrapper,
          {
            opacity: contentOpacity,
          },
        ]}>
        <Image
          source={require('../../assets/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        {/* Ilustración de automóvil */}
        <Animated.View
          style={[
            styles.carWrapper,
            {
              transform: [{ translateX: carTranslateX }],
            },
          ]}>
          <CarIllustration />
        </Animated.View>

        {/* Indicador de carga activo */}
        <ActivityIndicator size="large" color="#006FFF" style={styles.loader} />
      </Animated.View>
    </Animated.View>
  );
};

export default WelcomeScreen;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  contentWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 220,
    height: 70,
    marginBottom: 20,
  },
  carWrapper: {
    marginTop: 12,
  },
  loader: {
    marginTop: 28,
  },
});
