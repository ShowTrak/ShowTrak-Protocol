// SHA-1 checksums for script deployment.
//
// The Server hashes every file in a script folder and ships the digests in the
// Script.json manifest; the Client compares them to decide what to re-download,
// and verifies the bytes that arrive before writing them to a path it will later
// hand to spawn(). Both sides therefore have to agree on the algorithm exactly —
// which is why this is shared rather than implemented twice. It previously was
// implemented twice, and one of the copies went through the abandoned `checksum`
// package (last published 2017) whose default algorithm this preserves.
//
// SHA-1 is a deliberate choice here and not a security claim: these digests
// detect staleness and truncation over a trusted LAN, they are not a signature.
// Changing the algorithm is a wire-format change and must be done on both sides
// at once.
import { createHash } from 'crypto';
import fs from 'fs';

/** Optional sink for the one thing that can go wrong. Structural so this module
 * depends on neither app's Logger. */
export interface ChecksumErrorSink {
  (message: string): void;
}

/**
 * SHA-1 hex digest of a file's contents, or `null` when it cannot be read.
 *
 * Streamed rather than read whole — script payloads are arbitrary files.
 *
 * Never rejects: every caller treats "no checksum" as "assume stale and
 * re-download", which is the safe direction, so a read failure resolves `null`
 * and reports through `onError` if one is supplied.
 */
export function ChecksumFile(
  filePath: string,
  onError?: ChecksumErrorSink
): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      if (onError) onError(`Failed to checksum ${filePath}: ${String(err)}`);
      resolve(null);
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * SHA-1 hex digest of an in-memory buffer, for verifying downloaded bytes before
 * they are written to disk. Same algorithm as ChecksumFile, so the two are
 * directly comparable — which is the whole point at the download-verify step.
 */
export function ChecksumBuffer(contents: Buffer): string {
  return createHash('sha1').update(contents).digest('hex');
}
