/**
 * React Native has no Web Crypto (`crypto`). Supabase uses it for PKCE email
 * links: without it the code verifier comes from Math.random and the challenge
 * is sent in "plain". This provides the two pieces it needs from expo-crypto:
 * secure random values and SHA-256. Import it before creating the client.
 */
import { requireOptionalNativeModule } from 'expo';

type WebCryptoSubset = {
  getRandomValues: <T extends ArrayBufferView | null>(array: T) => T;
  subtle: { digest: (algorithm: string | { name: string }, data: BufferSource) => Promise<ArrayBuffer> };
};

const target = globalThis as { crypto?: Partial<WebCryptoSubset> };

// Builds made before expo-crypto was added lack its native module; keep the old behavior there.
if (requireOptionalNativeModule('ExpoCrypto') && !target.crypto?.subtle) {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when the native module exists */
  const ExpoCrypto = require('expo-crypto') as typeof import('expo-crypto');
  const existing = target.crypto ?? {};

  const getRandomValues = existing.getRandomValues ?? (<T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array;
    ExpoCrypto.getRandomValues(array as unknown as Uint8Array);
    return array;
  });

  target.crypto = {
    ...existing,
    getRandomValues,
    subtle: {
      digest: async (algorithm, data) => {
        const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase();
        if (name !== 'SHA-256') throw new Error(`Algoritmo no soportado: ${name}`);
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      },
    },
  };
}
