import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import * as Font from 'expo-font';

/**
 * Web: register and preload the icon font before any icon renders.
 *
 * Otherwise every icon starts its own Font.loadAsync on mount, without a catch.
 * On the web expo-font gives up after 12 s (slow network, tab in the
 * background), so a slow font became "Uncaught Error: 12000ms timeout
 * exceeded" and icons stayed blank or showed as squares.
 *
 * Registering the @font-face here makes Font.isLoaded() true from the first
 * render, so icons never start a load of their own; this load's own timeout is
 * caught. font-display: block hides the glyphs (instead of drawing squares)
 * while the file downloads, and the browser swaps them in whenever it arrives.
 */
export function preloadIconFonts() {
  if (typeof document === 'undefined') return;
  for (const [family, module] of Object.entries(Ionicons.font)) {
    const uri = Asset.fromModule(module as number).uri;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/ttf';
    link.crossOrigin = 'anonymous';
    link.href = uri;
    document.head.appendChild(link);
    Font.loadAsync({ [family]: { uri, display: Font.FontDisplay.BLOCK } }).catch(() => undefined);
  }
}
