import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, isDarkTheme } from '@/constants/colors';

interface WelcomeScreenProps {
  /** Start the intro once the native splash has been hidden. */
  start?: boolean;
  reduceMotion?: boolean;
  onAnimationComplete?: () => void;
}

// Same image and size as the native splash (app.json → expo-splash-screen, imageWidth 200),
// so the hand-off from the native splash to this screen has no visible jump.
const LOGO_SIZE = 200;
const ROUTE_WIDTH = 132;
const DOT = 10;

const logoLight = require('../../../assets/splash-icon-centered.png');
const logoDark = require('../../../assets/splash-icon-dark.png');

/**
 * Short branded intro: the wordmark from the native splash rises slightly while a route
 * draws between two points (origin → destination) and the tagline fades in, then the
 * whole overlay fades into the app. About 1.4 s; static with reduce motion.
 */
const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  start = true,
  reduceMotion = false,
  onAnimationComplete,
}) => {
  const { t } = useTranslation();
  const [overlay] = useState(() => new Animated.Value(1));
  const [lift] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const [route] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const [arrive] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  const [tagline] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));

  const doneRef = useRef(false);
  const onDoneRef = useRef(onAnimationComplete);
  useEffect(() => {
    onDoneRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => {
    if (!start) return;
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current?.();
    };
    // Never block the app if an animation callback is lost.
    const fallback = setTimeout(finish, 3000);

    const fadeOut = Animated.timing(overlay, {
      toValue: 0,
      duration: 320,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });

    const sequence = reduceMotion
      ? Animated.sequence([Animated.delay(700), fadeOut])
      : Animated.sequence([
          Animated.parallel([
            Animated.timing(lift, {
              toValue: 1,
              duration: 520,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.delay(120),
              Animated.timing(route, {
                toValue: 1,
                duration: 560,
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: false, // animates width
              }),
            ]),
          ]),
          Animated.parallel([
            Animated.spring(arrive, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
            Animated.timing(tagline, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          Animated.delay(380),
          fadeOut,
        ]);

    sequence.start(finish);
    return () => {
      clearTimeout(fallback);
      sequence.stop();
    };
  }, [start, reduceMotion, overlay, lift, route, arrive, tagline]);

  const logoTranslate = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -28] });
  const lineWidth = route.interpolate({ inputRange: [0, 1], outputRange: [0, ROUTE_WIDTH - DOT] });
  const routeOpacity = route.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1] });
  const arriveScale = arrive.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const taglineTranslate = tagline.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  return (
    <Animated.View
      style={[styles.container, { backgroundColor: colors.background, opacity: overlay }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.Image
        source={isDarkTheme ? logoDark : logoLight}
        style={[styles.logo, { transform: [{ translateY: logoTranslate }] }]}
        resizeMode="contain"
      />

      <View style={styles.below}>
        <Animated.View style={[styles.route, { opacity: routeOpacity }]}>
          <View style={[styles.dot, styles.origin, { borderColor: colors.primary }]} />
          <Animated.View style={[styles.line, { width: lineWidth, backgroundColor: colors.primary }]} />
          <Animated.View
            style={[
              styles.dot,
              styles.destination,
              { backgroundColor: colors.primary, opacity: arrive, transform: [{ scale: arriveScale }] },
            ]}
          />
        </Animated.View>

        <Animated.View style={{ opacity: tagline, transform: [{ translateY: taglineTranslate }] }}>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>{t('welcome.tagline')}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
};

export default WelcomeScreen;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  // Sits right under the wordmark (the wordmark is ~1/4 of the square's height, centered).
  below: {
    position: 'absolute',
    top: '50%',
    marginTop: 16,
    alignItems: 'center',
  },
  route: {
    width: ROUTE_WIDTH,
    height: DOT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  origin: {
    position: 'absolute',
    left: 0,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  line: {
    position: 'absolute',
    left: DOT / 2,
    height: 2,
    borderRadius: 1,
  },
  destination: {
    position: 'absolute',
    right: 0,
  },
  tagline: {
    marginTop: 18,
    fontSize: 14,
    letterSpacing: 0.2,
  },
});
