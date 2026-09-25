export const colors = {
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
  white: '#FFFFFF',
  error: '#D92D20',
  success: '#12B76A',
  warning: '#F79009',
  shadow: '#000000',
} as const;

export type ColorToken = keyof typeof colors;
