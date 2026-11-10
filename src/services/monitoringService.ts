import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { Json } from '@/lib/database.types';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import {
  type AppEventName, cleanProps, createThrottle, describeError, screenName,
} from '@/services/monitoringCore';

/**
 * Errors and a handful of usage events, sent to our own Supabase (migration 045) with the app
 * version and platform. Fire and forget: nothing here ever throws or blocks the UI, and in
 * development builds nothing is sent (errors are only logged).
 */

const appVersion = () => Constants.expoConfig?.version ?? null;
const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : 'unknown';
const enabled = isSupabaseEnabled && !__DEV__;
// The same error at most once a minute, and at most 40 errors / 200 events per session.
const errorThrottle = createThrottle(60_000, 40);
const eventThrottle = createThrottle(1_000, 200);
let currentScreen = 'index';

type ErrorReport = { message: string; stack: string | null; screen: string; fatal: boolean; version: string | null };

async function send(report: ErrorReport) {
  const { error } = await supabase.rpc('report_client_error', {
    p_message: report.message,
    p_stack: report.stack ?? undefined,
    p_screen: report.screen,
    p_app_version: report.version ?? undefined,
    p_platform: platform,
    p_fatal: report.fatal,
  });
  if (error) throw error;
}

// A fatal error on a phone kills the app before a request can finish: it is written to a file
// synchronously and sent on the next launch.
const PENDING_FILE = 'pending-error.json';
function pendingFile() {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    return new File(Paths.document, PENDING_FILE);
  } catch {
    return null;
  }
}

export const monitoring = {
  /** The current route pattern (from useSegments), attached to errors. */
  setScreen(segments: readonly string[]) {
    currentScreen = screenName(segments);
  },

  reportError(error: unknown, fatal = false) {
    const { message, stack } = describeError(error);
    if (__DEV__) console.warn('[monitoring]', message);
    if (!enabled || !errorThrottle(message)) return;
    const report: ErrorReport = { message, stack, screen: currentScreen, fatal, version: appVersion() };
    if (fatal) {
      try {
        pendingFile()?.writeSync(JSON.stringify(report));
      } catch {
        // No file: try sending right away.
      }
    }
    void send(report).then(() => { if (fatal) pendingFile()?.delete(); }).catch(() => undefined);
  },

  track(name: AppEventName, props?: Record<string, unknown>) {
    if (!enabled || !eventThrottle(name)) return;
    void supabase.rpc('track_app_event', {
      p_name: name,
      p_props: cleanProps(props) as Json,
      p_app_version: appVersion() ?? undefined,
      p_platform: platform,
    }).then(() => undefined, () => undefined);
  },

  /** Once, at startup: global JS errors (phones) or window errors (web), plus a fatal one left from the last run. */
  install() {
    if (installed) return;
    installed = true;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('error', (event) => monitoring.reportError(event.error ?? event.message));
        window.addEventListener('unhandledrejection', (event) => monitoring.reportError(event.reason));
      }
    } else {
      const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
      const previous = errorUtils?.getGlobalHandler();
      errorUtils?.setGlobalHandler((error, isFatal) => {
        monitoring.reportError(error, isFatal === true);
        previous?.(error, isFatal);
      });
    }
    if (!enabled) return;
    try {
      const file = pendingFile();
      if (file?.exists) {
        const report = JSON.parse(file.textSync()) as ErrorReport;
        file.delete();
        if (typeof report?.message === 'string') void send(report).catch(() => undefined);
      }
    } catch {
      // A corrupt leftover is dropped.
    }
  },
};

type GlobalErrorUtils = {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
};
let installed = false;
