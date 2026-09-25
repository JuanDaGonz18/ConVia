import { Text, TextInput, TextInputProps, View, StyleSheet } from 'react-native';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  disabled?: boolean;
};

export function TextField({
  label,
  error,
  disabled = false,
  editable,
  style,
  ...props
}: TextFieldProps) {
  const isEditable = editable ?? !disabled;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label ?? props.placeholder}
        editable={isEditable}
        placeholderTextColor={colors.textSecondary}
        style={[
          styles.input,
          error ? styles.inputError : null,
          disabled ? styles.disabled : null,
          style,
        ]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[8],
  },
  label: {
    ...typography.label,
    color: colors.text,
  },
  input: {
    ...typography.body,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    color: colors.text,
    height: dimensions.controlHeight,
    paddingHorizontal: spacing[16],
  },
  inputError: {
    borderColor: colors.error,
  },
  disabled: {
    backgroundColor: colors.lightGray,
    opacity: 0.72,
  },
  error: {
    ...typography.caption,
    color: colors.error,
  },
});
