import { useEffect, useRef } from 'react';
import type { DateTimePickerProps } from '@expo/ui/community/datetime-picker';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Browser version of the picker: a native <input type="date|time">, opened right away (like the
 * phone's dialog). Same contract as @expo/ui's picker: onValueChange with the picked Date,
 * onDismiss when the person leaves without choosing.
 */
export function DateTimePicker({ value, mode = 'date', minimumDate, maximumDate, onValueChange, onDismiss }: DateTimePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const kind = mode === 'time' ? 'time' : 'date';

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.focus();
    try {
      element.showPicker?.();
    } catch {
      // Some browsers only open the picker from a click; the focused field still works.
    }
  }, []);

  const change = (raw: string) => {
    if (!raw) return;
    const next = new Date(value);
    if (kind === 'date') {
      const [y, m, d] = raw.split('-').map(Number);
      next.setFullYear(y, m - 1, d);
    } else {
      const [h, min] = raw.split(':').map(Number);
      next.setHours(h, min, 0, 0);
    }
    onValueChange?.({ nativeEvent: { timestamp: next.getTime(), utcOffset: -next.getTimezoneOffset() } }, next);
  };

  return (
    <input
      aria-label={kind === 'date' ? 'Fecha' : 'Hora'}
      defaultValue={kind === 'date' ? toDateValue(value) : toTimeValue(value)}
      max={kind === 'date' && maximumDate ? toDateValue(maximumDate) : undefined}
      min={kind === 'date' && minimumDate ? toDateValue(minimumDate) : undefined}
      onBlur={() => onDismiss?.()}
      onChange={(event) => change(event.currentTarget.value)}
      ref={input}
      style={{ alignSelf: 'flex-start', border: '1px solid #C5C6CC', borderRadius: 12, fontSize: 16, padding: '10px 12px' }}
      type={kind}
    />
  );
}
