import { TextStyle } from 'react-native';

const family = 'System';

export const typography = {
  headingXL: {
    fontFamily: family,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  headingL: {
    fontFamily: family,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  headingM: {
    fontFamily: family,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  },
  body: {
    fontFamily: family,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily: family,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
  },
  bodySmall: {
    fontFamily: family,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  caption: {
    fontFamily: family,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
  },
  button: {
    fontFamily: family,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  label: {
    fontFamily: family,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
} satisfies Record<string, TextStyle>;
