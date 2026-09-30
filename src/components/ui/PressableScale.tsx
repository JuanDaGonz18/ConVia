import { ReactNode, useState } from 'react';
import { Animated, Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** How far it shrinks while pressed (1 = no effect). */
  pressedScale?: number;
};

/** A Pressable that gently shrinks while held, so taps feel physical. */
export function PressableScale({ style, children, pressedScale = 0.97, onPressIn, onPressOut, disabled, ...props }: PressableScaleProps) {
  // Animated values live in state: stable across renders and readable in render.
  const [scale] = useState(() => new Animated.Value(1));
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) animate(pressedScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
