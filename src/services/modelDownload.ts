/**
 * Download-and-verify loop for files the app fetches on first use (the face model).
 * Pure logic, so it is unit-tested without the native file system.
 */
export type VerifiedDownload = {
  /** Writes the download to a temporary file (replacing any previous one). */
  download: () => Promise<void>;
  /** Lowercase hex SHA-256 of the temporary file. */
  sha256: () => Promise<string>;
  /** Moves the verified temporary file to its final place. */
  commit: () => void;
  /** Removes the temporary file; must not throw. */
  discard: () => void;
};

export type RetryOptions = {
  expectedSha256: string;
  attempts: number;
  /** Delay before retry n (1-based): 1 s, 2 s, 4 s… */
  sleep?: (ms: number) => Promise<void>;
  onError?: (attempt: number, error: unknown) => void;
};

export class ChecksumMismatchError extends Error {
  constructor() {
    super('downloaded file checksum mismatch');
    this.name = 'ChecksumMismatchError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Returns true once a download matches the expected SHA-256; false after every attempt failed. */
export async function downloadVerified(file: VerifiedDownload, options: RetryOptions): Promise<boolean> {
  const sleep = options.sleep ?? defaultSleep;
  const expected = options.expectedSha256.toLowerCase();
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      await file.download();
      if ((await file.sha256()).toLowerCase() !== expected) throw new ChecksumMismatchError();
      file.commit();
      return true;
    } catch (error) {
      file.discard();
      options.onError?.(attempt, error);
      if (attempt < options.attempts) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  return false;
}
