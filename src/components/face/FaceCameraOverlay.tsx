/**
 * FaceCameraOverlay.tsx
 *
 * Guía visual sobre la CameraView que le indica al usuario cómo posicionarse.
 * Muestra:
 *   - Óvalo recortado sobre el frame de la cámara
 *   - Instrucción de texto según el estado actual
 *   - Indicador de progreso animado mientras procesa
 *   - Icono de resultado (check/error)
 */

import React, { useEffect } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { FaceVerificationState } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  state: FaceVerificationState;
  /** Mensaje personalizado (sobreescribe el predeterminado del estado) */
  message?: string;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const OVAL_W = SCREEN_W * 0.68;
const OVAL_H = OVAL_W * 1.35;

// ─── Mensajes por estado ──────────────────────────────────────────────────────

const STATE_MESSAGES: Record<FaceVerificationState, string> = {
  IDLE: 'Preparando cámara…',
  CAMERA_PERMISSION: 'Se necesita acceso a la cámara',
  DETECTING_FACE: 'Buscando tu rostro…',
  FACE_DETECTED: 'Rostro detectado',
  POSITIONING: 'Centra tu rostro en el óvalo',
  LIVENESS: 'Quédate quieto un momento',
  CAPTURING: 'Capturando muestra segura…',
  GENERATING_EMBEDDING: 'Generando representación facial…',
  PROCESSING: 'Analizando…',
  MATCHING: 'Verificando identidad…',
  SUCCESS: '¡Verificación exitosa!',
  FAILED: 'No pudimos verificarte',
  RETRY: 'Inténtalo de nuevo',
  BLOCKED: 'Demasiados intentos fallidos',
};

// ─── Colores del óvalo según estado ──────────────────────────────────────────

function ovalColor(state: FaceVerificationState): string {
  if (state === 'SUCCESS') return colors.success;
  if (state === 'FAILED' || state === 'BLOCKED') return colors.error;
  if (state === 'LIVENESS' || state === 'PROCESSING' || state === 'MATCHING') {
    return colors.primary;
  }
  return 'rgba(255,255,255,0.65)';
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function FaceCameraOverlay({ state, message }: Props) {
  // Pulsación animada del borde del óvalo
  const [pulseAnim] = React.useState(() => new Animated.Value(1));
  const [opacityAnim] = React.useState(() => new Animated.Value(0));

  useEffect(() => {
    const isActive =
      state === 'LIVENESS' ||
      state === 'PROCESSING' ||
      state === 'MATCHING';

    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.04,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  // Fade in del ícono de resultado
  useEffect(() => {
    if (state === 'SUCCESS' || state === 'FAILED') {
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }).start();
    } else {
      opacityAnim.setValue(0);
    }
  }, [state, opacityAnim]);

  const displayMessage = message ?? STATE_MESSAGES[state];
  const borderColor = ovalColor(state);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Sombra semitransparente con recorte ovalado */}
      <OvalCutout borderColor={borderColor} pulseAnim={pulseAnim} />

      {/* Texto de instrucción */}
      <View style={styles.messageContainer}>
        <Text style={styles.messageText}>{displayMessage}</Text>
      </View>

      {/* Ícono resultado */}
      {(state === 'SUCCESS' || state === 'FAILED') && (
        <Animated.View style={[styles.resultIcon, { opacity: opacityAnim }]}>
          <Text style={styles.resultEmoji}>
            {state === 'SUCCESS' ? '✓' : '✕'}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Sub-componente: máscara SVG + borde ovalado ──────────────────────────────

function OvalCutout({
  borderColor,
  pulseAnim,
}: {
  borderColor: string;
  pulseAnim: Animated.Value;
}) {
  const { width: W, height: H } = Dimensions.get('window');
  const cx = W / 2;
  const cy = H * 0.42;
  const rx = OVAL_W / 2;
  const ry = OVAL_H / 2;

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ scale: pulseAnim }] },
      ]}
    >
      {/* Capa oscura con recorte ovalado transparente */}
      <Svg width={W} height={H}>
        <Defs>
          <Mask id="ovalMask" x="0" y="0" width={W} height={H}>
            {/* Fondo blanco = visible */}
            <Rect x="0" y="0" width={W} height={H} fill="white" />
            {/* Óvalo negro = recortado (transparente) */}
            <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="black" />
          </Mask>
        </Defs>
        {/* Capa semitransparente con hueco ovalado */}
        <Rect
          x="0"
          y="0"
          width={W}
          height={H}
          fill="rgba(0,0,0,0.55)"
          mask="url(#ovalMask)"
        />
        {/* Borde del óvalo */}
        <Ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          stroke={borderColor}
          strokeWidth={3}
        />
      </Svg>
    </Animated.View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  messageContainer: {
    position: 'absolute',
    bottom: '20%',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing[24],
  },
  messageText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  resultIcon: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultEmoji: {
    color: colors.white,
    fontSize: 30,
    fontWeight: '700',
  },
});
