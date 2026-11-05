import { activeColorScheme } from '@/theme/themePreference';

const light = {
  primary: '#006FFD',
  primaryPressed: '#0056C7',
  primaryLight: '#EAF2FF',
  text: '#1F2024',
  textSecondary: '#71727A',
  border: '#C5C6CC',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F8F9FE',
  lightGray: '#E8E9F1',
  /** Card and control backgrounds (white in the light theme). */
  white: '#FFFFFF',
  /** Text and icons on primary, success or error fills, and on photos or maps: always white. */
  onPrimary: '#FFFFFF',
  error: '#D92D20',
  success: '#12B76A',
  warning: '#F79009',
  shadow: '#000000',
  /** Tinted backgrounds, borders and text for notices, badges and alerts. */
  primaryBorder: '#C3DBFF',
  errorLight: '#FEF3F2',
  errorBorder: '#FECDCA',
  errorText: '#B42318',
  successLight: '#ECFDF3',
  successBorder: '#ABEFC6',
  successText: '#067647',
  warningLight: '#FFFAEB',
  warningBorder: '#FEDF89',
  warningText: '#B54708',
};

export type Palette = typeof light;

const dark: Palette = {
  primary: '#4D9BFF',
  primaryPressed: '#7AB4FF',
  primaryLight: '#14243D',
  text: '#F2F3F7',
  textSecondary: '#A3A5AE',
  border: '#3D3F47',
  background: '#111215',
  surface: '#1B1C21',
  surfaceMuted: '#17181C',
  lightGray: '#2A2C33',
  white: '#1B1C21',
  onPrimary: '#FFFFFF',
  error: '#F97066',
  success: '#32D583',
  warning: '#FDB022',
  shadow: '#000000',
  primaryBorder: '#25426B',
  errorLight: '#3B1C1A',
  errorBorder: '#7A2E28',
  errorText: '#FDA29B',
  successLight: '#0F2E22',
  successBorder: '#1F5F44',
  successText: '#75E0A7',
  warningLight: '#33260F',
  warningBorder: '#6B4E16',
  warningText: '#FEC84B',
};

/**
 * The app's colors for the theme chosen when the app started (Profile → Apariencia e idioma).
 * Screens build their StyleSheets from it once, so a new theme applies after a reload.
 */
export const colors: Readonly<Palette> = activeColorScheme === 'dark' ? dark : light;

export const isDarkTheme = activeColorScheme === 'dark';

export type ColorToken = keyof Palette;
