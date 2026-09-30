import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TextField, TextFieldProps } from '@/components/forms/TextField';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { PASSWORD_RULES } from '@/utils/password';

/** Password input with an eye button to show or hide what was typed. */
export const PasswordField = forwardRef<TextInput, Omit<TextFieldProps, 'secureTextEntry' | 'right'>>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      autoCapitalize="none"
      autoCorrect={false}
      ref={ref}
      right={(
        <Pressable
          accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setVisible(!visible)}
          style={styles.eye}
        >
          <Ionicons color={colors.textSecondary} name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} />
        </Pressable>
      )}
      secureTextEntry={!visible}
      textContentType="password"
      {...props}
    />
  );
});

/**
 * Live checklist of the password rules plus the match with its confirmation.
 * Rules turn green as they are met, so the person knows what is still missing.
 */
export function PasswordChecklist({ password, confirm }: Readonly<{ password: string; confirm: string }>) {
  const items = [
    ...PASSWORD_RULES.map((rule) => ({ label: rule.label, ok: rule.test(password) })),
    { label: 'Las dos contraseñas coinciden', ok: !!confirm && confirm === password },
  ];
  return (
    <View accessibilityLabel="Requisitos de la contraseña" style={styles.list}>
      {items.map((item) => (
        <View key={item.label} style={styles.item}>
          <Ionicons
            color={item.ok ? colors.success : colors.border}
            name={item.ok ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
          />
          <Text style={[styles.text, item.ok ? styles.textOk : null]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  eye: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  list: { gap: 6, paddingHorizontal: spacing[4] },
  item: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  text: { ...typography.caption, color: colors.textSecondary },
  textOk: { color: '#067647', fontWeight: '600' },
});
