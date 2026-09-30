import { forwardRef, ReactNode, useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

export type TextFieldProps = TextInputProps & {
  label?: string;
  /** Shown under the field in red; also marks the field as invalid. */
  error?: string | null;
  /** Neutral help text under the field. */
  hint?: string;
  disabled?: boolean;
  /** Element inside the field, on the right (e.g. show/hide password). */
  right?: ReactNode;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, disabled = false, editable, style, right, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isEditable = editable ?? !disabled;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.box,
          focused ? styles.boxFocused : null,
          error ? styles.boxError : null,
          disabled ? styles.boxDisabled : null,
        ]}
      >
        <TextInput
          accessibilityHint={error ?? hint}
          accessibilityLabel={label ?? props.placeholder}
          editable={isEditable}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={colors.textSecondary}
          ref={ref}
          style={[styles.input, style]}
          {...props}
        />
        {right}
      </View>
      {error ? (
        <View style={styles.messageRow}>
          <Ionicons color={colors.error} name="alert-circle" size={14} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing[8] },
  label: { ...typography.label, color: colors.text },
  box: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: dimensions.controlHeight + 4,
  },
  boxFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  boxError: { backgroundColor: '#FFFBFA', borderColor: colors.error },
  boxDisabled: { backgroundColor: colors.lightGray, opacity: 0.72 },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    minHeight: dimensions.controlHeight + 2,
    paddingHorizontal: spacing[16],
  },
  messageRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  error: { ...typography.caption, color: colors.error, flex: 1 },
  hint: { ...typography.caption, color: colors.textSecondary },
});
