import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Head from 'expo-router/head';
import { Redirect, router } from 'expo-router';

import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import {
  type AdminInstitution,
  type AdminPanel,
  adminService,
  candidateDomains,
  type CommunityType,
  type InstitutionRequest,
  type MembershipReview,
  parseDomains,
  type RejectReason,
} from '@/services/adminService';
import { errorMessage } from '@/utils/format';

/**
 * Admin panel, web only. No button in the app leads here; the address is the only way in, and the
 * server refuses everything unless the session belongs to an account in private.admins.
 * Anyone else sees "page not found". Spanish only: it is for the ConVía team.
 */

const REJECT_REASONS: { key: RejectReason; label: string }[] = [
  { key: 'unclear', label: 'No se ve claro / información insuficiente' },
  { key: 'mismatch', label: 'Nombre, institución o correo no coinciden' },
  { key: 'not_student', label: 'No parece un carné vigente de esa institución' },
];

const KIND_LABEL: Record<string, string> = { card_photo: 'Carné con foto', document: 'Carné sin foto + captura de cuenta' };

type Gate = 'loading' | 'signed_out' | 'denied' | 'ok';

const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default function AdminScreen() {
  const [gate, setGate] = useState<Gate>('loading');
  const [panel, setPanel] = useState<AdminPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setPanel(await adminService.load());
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudo cargar el panel.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) return setGate('signed_out');
      const admin = await adminService.amIAdmin().catch(() => false);
      if (!active) return;
      setGate(admin ? 'ok' : 'denied');
      if (admin) void load();
    })();
    return () => { active = false; };
  }, [load]);

  const done = (text: string) => {
    setMessage(text);
    void load();
  };

  if (Platform.OS !== 'web') return <Redirect href="/" />;

  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.scroll}>
      <Head>
        <title>ConVía</title>
        <meta content="noindex, nofollow" name="robots" />
      </Head>
      <View style={styles.inner}>
        {gate === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}
        {gate === 'signed_out' ? (
          <View style={styles.center}>
            <Text style={styles.h1}>Inicia sesión</Text>
            <ButtonPrimary onPress={() => router.push('/(auth)/login')} title="Ir a iniciar sesión" />
          </View>
        ) : null}
        {gate === 'denied' ? (
          <View style={styles.center}>
            <Text style={styles.h1}>Página no encontrada</Text>
            <ButtonSecondary onPress={() => router.replace('/')} title="Volver" />
          </View>
        ) : null}
        {gate === 'ok' ? (
          <>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>CONVÍA · ADMINISTRACIÓN</Text>
                <Text style={styles.h1}>Solicitudes</Text>
              </View>
              <ButtonSecondary icon="refresh" loading={refreshing} onPress={() => void load()} title="Actualizar" />
            </View>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {message ? <Notice onDismiss={() => setMessage(null)} tone="success">{message}</Notice> : null}
            {panel ? (
              <>
                <View style={styles.stats}>
                  <Stat label="Usuarios" value={panel.stats.usuarios} />
                  <Stat label="Nuevos (7 días)" value={panel.stats.nuevos_7d} />
                  <Stat label="Verificados" value={panel.stats.verificados} />
                  <Stat label="ConVía+ activos" value={panel.stats.plus_activos} />
                  <Stat label="Viajes (7 días)" value={panel.stats.viajes_7d} />
                </View>

                <Text style={styles.h2}>Carnés en revisión ({panel.memberships.length})</Text>
                {panel.memberships.length === 0 ? <Text style={styles.empty}>Nada por revisar.</Text> : null}
                {panel.memberships.map((item) => (
                  <MembershipCard item={item} key={item.user_id} onDone={done} onError={setError} />
                ))}

                <Text style={styles.h2}>Solicitudes de institución ({panel.requests.length})</Text>
                {panel.requests.length === 0 ? <Text style={styles.empty}>Nada por revisar.</Text> : null}
                {panel.requests.map((item) => (
                  <RequestCard institutions={panel.institutions} item={item} key={item.id} onDone={done} onError={setError} />
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.small}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Text style={styles.body}>
      <Text style={styles.label}>{label}: </Text>
      {String(value)}
    </Text>
  );
}

type CardProps<T> = { item: T; onDone: (message: string) => void; onError: (message: string) => void };

function MembershipCard({ item, onDone, onError }: CardProps<MembershipReview>) {
  const [images, setImages] = useState<{ path: string; url: string }[] | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const check = item.check;

  useEffect(() => {
    let active = true;
    adminService.reviewImages(item.user_id)
      .then((found) => { if (active) setImages(found); })
      .catch(() => { if (active) setImages([]); });
    return () => { active = false; };
  }, [item.user_id]);

  const decide = async (approve: boolean, reason?: RejectReason) => {
    setBusy(true);
    try {
      await adminService.decideMembership(item.user_id, approve, reason);
      onDone(approve ? `${item.nombre ?? 'Usuario'}: verificado.` : `${item.nombre ?? 'Usuario'}: rechazado, puede intentarlo de nuevo.`);
    } catch (decideError) {
      onError(errorMessage(decideError, 'No se pudo guardar la decisión.'));
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>{item.nombre ?? 'Sin nombre'}</Text>
      <Row label="Correo" value={item.email} />
      <Row label="Institución elegida" value={item.institucion} />
      <Row label="En revisión desde" value={fecha(item.desde)} />
      {check ? (
        <View style={styles.box}>
          <Row label="Tipo" value={KIND_LABEL[check.kind] ?? check.kind} />
          <Row label="Institución leída" value={check.institution_read} />
          <Row label="Parecido del nombre" value={check.name_similarity != null ? `${Math.round(check.name_similarity * 100)}%` : null} />
          <Row label="Dominio de correo" value={check.email_domain} />
          <Row label="Vence" value={check.expires_on} />
          <Row label="Parece real" value={check.looks_real == null ? null : check.looks_real ? 'Sí' : 'No'} />
          <Row label="Coincidencia de cara" value={check.face_match != null ? `${Math.round(check.face_match * 100)}%` : 'No se comparó'} />
          <Row label="Motivos" value={check.reasons?.join(', ')} />
          <Row label="Resumen" value={check.summary} />
        </View>
      ) : null}
      <View style={styles.images}>
        {images === null ? <ActivityIndicator color={colors.primary} /> : null}
        {images?.length === 0 ? <Text style={styles.small}>No hay imágenes guardadas (se borran a los 7 días).</Text> : null}
        {images?.map((image) => (
          <Pressable key={image.path} onPress={() => void Linking.openURL(image.url)}>
            <Image resizeMode="contain" source={{ uri: image.url }} style={styles.image} />
          </Pressable>
        ))}
      </View>
      {rejecting ? (
        <View style={styles.actions}>
          {REJECT_REASONS.map((reason) => (
            <ButtonSecondary disabled={busy} key={reason.key} onPress={() => void decide(false, reason.key)} title={reason.label} />
          ))}
          <ButtonSecondary disabled={busy} onPress={() => setRejecting(false)} title="Cancelar" />
        </View>
      ) : (
        <View style={styles.actions}>
          <ButtonPrimary icon="checkmark" loading={busy} onPress={() => void decide(true)} title="Aprobar" />
          <ButtonSecondary disabled={busy} icon="close" onPress={() => setRejecting(true)} title="Rechazar…" />
        </View>
      )}
    </View>
  );
}

type Mode = 'idle' | 'approve' | 'merge' | 'reject';

function RequestCard({ item, institutions, onDone, onError }: CardProps<InstitutionRequest> & { institutions: AdminInstitution[] }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [nombre, setNombre] = useState(item.nombre);
  const [domains, setDomains] = useState(candidateDomains(item).join(', '));
  const [tipo, setTipo] = useState<CommunityType>('universidad');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<AdminInstitution | null>(null);
  const [motivo, setMotivo] = useState('');

  const matches = useMemo(() => {
    const text = (search || item.nombre).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const words = text.split(/\s+/).filter((w) => w.length > 2 && !['universidad', 'institucion', 'corporacion', 'fundacion'].includes(w));
    return institutions
      .map((inst) => {
        const name = `${inst.nombre} ${inst.nombre_corto ?? ''} ${inst.dominios.join(' ')}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        return { inst, score: words.filter((w) => name.includes(w)).length };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((m) => m.inst);
  }, [institutions, item.nombre, search]);

  const run = async (action: () => Promise<void>, text: string) => {
    setBusy(true);
    try {
      await action();
      onDone(text);
    } catch (actionError) {
      onError(errorMessage(actionError, 'No se pudo guardar la decisión.'));
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>{item.nombre}</Text>
      <Row label="Ciudad" value={item.ciudad} />
      <Row label="Sitio web" value={item.sitio_web} />
      <Row label="Rol" value={item.rol} />
      <Row label="Pidió" value={`${item.solicitante ?? '—'} (${item.email ?? 'sin correo'}) · ${fecha(item.created_at)}`} />
      <Row label="Su estado actual" value={item.membresia ? `${item.membresia}${item.membresia_institucion ? ` en ${item.membresia_institucion}` : ''}` : 'sin institución'} />
      {item.sitio_web ? (
        <Pressable onPress={() => void Linking.openURL(/^https?:\/\//i.test(item.sitio_web!) ? item.sitio_web! : `https://${item.sitio_web}`)}>
          <Text style={styles.link}>Abrir sitio web</Text>
        </Pressable>
      ) : null}

      {mode === 'idle' ? (
        <View style={styles.actions}>
          <ButtonPrimary icon="add" onPress={() => setMode('approve')} title="Crear institución" />
          <ButtonSecondary icon="git-merge-outline" onPress={() => setMode('merge')} title="Ya existe: unir" />
          <ButtonSecondary icon="close" onPress={() => setMode('reject')} title="Rechazar…" />
        </View>
      ) : null}

      {mode === 'approve' ? (
        <View style={styles.form}>
          <TextField label="Nombre" onChangeText={setNombre} value={nombre} />
          <TextField
            autoCapitalize="none"
            hint="Separados por coma. El primero es el principal. Quien tenga correo de estos dominios queda verificado."
            label="Dominios de correo"
            onChangeText={setDomains}
            placeholder="ej. unicundi.edu.co"
            value={domains}
          />
          <View style={styles.actions}>
            {(['universidad', 'empresa'] as const).map((value) => (
              <Pressable key={value} onPress={() => setTipo(value)} style={[styles.chip, tipo === value && styles.chipOn]}>
                <Text style={[styles.small, tipo === value && styles.chipTextOn]}>{value === 'universidad' ? 'Universidad' : 'Empresa'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actions}>
            <ButtonPrimary
              disabled={!nombre.trim() || parseDomains(domains).length === 0}
              loading={busy}
              onPress={() => void run(() => adminService.approveRequest(item.id, nombre.trim(), parseDomains(domains), tipo), `${nombre.trim()}: creada.`)}
              title="Crear y aprobar"
            />
            <ButtonSecondary disabled={busy} onPress={() => setMode('idle')} title="Cancelar" />
          </View>
        </View>
      ) : null}

      {mode === 'merge' ? (
        <View style={styles.form}>
          <TextField label="Buscar institución existente" onChangeText={setSearch} placeholder={item.nombre} value={search} />
          {matches.length === 0 ? <Text style={styles.small}>Sin coincidencias.</Text> : null}
          {matches.map((inst) => (
            <Pressable key={inst.id} onPress={() => setTarget(inst)} style={[styles.option, target?.id === inst.id && styles.chipOn]}>
              <Text style={[styles.body, target?.id === inst.id && styles.chipTextOn]}>
                {inst.nombre}{inst.ciudad ? ` · ${inst.ciudad}` : ''}{inst.dominios.length ? ` · ${inst.dominios.join(', ')}` : ''}
              </Text>
            </Pressable>
          ))}
          <TextField
            autoCapitalize="none"
            hint="Opcional: dominios nuevos para agregarle."
            label="Agregar dominios"
            onChangeText={setDomains}
            value={domains}
          />
          <View style={styles.actions}>
            <ButtonPrimary
              disabled={!target}
              loading={busy}
              onPress={() => target && void run(() => adminService.mergeRequest(item.id, target.id, parseDomains(domains)), `Unida a ${target.nombre}.`)}
              title="Unir y aprobar"
            />
            <ButtonSecondary disabled={busy} onPress={() => setMode('idle')} title="Cancelar" />
          </View>
        </View>
      ) : null}

      {mode === 'reject' ? (
        <View style={styles.form}>
          <TextField label="Motivo (lo ve quien la pidió)" maxLength={300} multiline onChangeText={setMotivo} value={motivo} />
          <View style={styles.actions}>
            <ButtonPrimary
              disabled={motivo.trim().length < 3}
              loading={busy}
              onPress={() => void run(() => adminService.rejectRequest(item.id, motivo.trim()), `${item.nombre}: rechazada.`)}
              title="Rechazar"
              tone="danger"
            />
            <ButtonSecondary disabled={busy} onPress={() => setMode('idle')} title="Cancelar" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { backgroundColor: colors.background, flex: 1 },
  page: { alignItems: 'center', padding: spacing[24] },
  inner: { gap: spacing[16], maxWidth: 1000, width: '100%' },
  center: { alignItems: 'center', gap: spacing[16], paddingVertical: spacing[64] },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  h1: { ...typography.headingXL, color: colors.text },
  h2: { ...typography.headingM, color: colors.text, marginTop: spacing[16] },
  h3: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  body: { ...typography.bodySmall, color: colors.text },
  label: { ...typography.bodySmall, color: colors.textSecondary },
  small: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textSecondary },
  link: { ...typography.bodySmall, color: colors.primary, textDecorationLine: 'underline' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[12] },
  stat: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.radiusMedium, borderWidth: 1, minWidth: 150, padding: spacing[16] },
  statValue: { ...typography.headingL, color: colors.text },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[8], padding: spacing[20] },
  box: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusMedium, gap: spacing[4], padding: spacing[12] },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[12] },
  image: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusMedium, height: 260, width: 360 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  form: { gap: spacing[12] },
  chip: { borderColor: colors.border, borderRadius: radius.radiusFull, borderWidth: 1, paddingHorizontal: spacing[16], paddingVertical: spacing[8] },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTextOn: { color: colors.onPrimary },
  option: { borderColor: colors.border, borderRadius: radius.radiusMedium, borderWidth: 1, padding: spacing[12] },
});
