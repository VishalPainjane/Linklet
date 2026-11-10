/**
 * Cryptographically secure Base62 short code generator with rejection sampling.
 * Eliminates modulo bias (256 % 62 != 0; values >= 248 are rejected).
 */

export const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" as const;
export const DEFAULT_CODE_LENGTH = 8;
export const REJECTION_THRESHOLD = 248; // 4 * 62 = 248. Remaining 8 bytes (248-255) are rejected.

export interface CodeGenerator {
  generate(length?: number): string;
}

export class CryptoCodeGenerator implements CodeGenerator {
  private readonly defaultLength: number;

  constructor(defaultLength = DEFAULT_CODE_LENGTH) {
    if (defaultLength <= 0) {
      throw new RangeError("Code length must be greater than zero");
    }
    this.defaultLength = defaultLength;
  }

  public generate(length = this.defaultLength): string {
    if (length <= 0) {
      throw new RangeError("Code length must be greater than zero");
    }

    let result = "";
    // Buffer size proportional to requested length, with headroom for rejection
    const bufferSize = Math.max(32, length * 2);
    const bytes = new Uint8Array(bufferSize);

    while (result.length < length) {
      crypto.getRandomValues(bytes);
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]!;
        if (byte >= REJECTION_THRESHOLD) {
          // Reject biased tail [248..255]
          continue;
        }
        result += BASE62_ALPHABET[byte % 62];
        if (result.length === length) {
          return result;
        }
      }
    }

    return result;
  }
}

/**
 * Deterministic generator for concurrency and collision recovery testing.
 * Can yield planned collisions before yielding unique codes.
 */
export class DeterministicCodeGenerator implements CodeGenerator {
  private readonly sequence: string[];
  private index = 0;

  constructor(sequence: string[]) {
    if (sequence.length === 0) {
      throw new Error("Deterministic sequence cannot be empty");
    }
    this.sequence = sequence;
  }

  public generate(): string {
    const code = this.sequence[this.index % this.sequence.length]!;
    this.index += 1;
    return code;
  }

  public reset(): void {
    this.index = 0;
  }
}

// Default singleton instance
export const defaultCodeGenerator = new CryptoCodeGenerator();

export function generateCode(length = DEFAULT_CODE_LENGTH): string {
  return defaultCodeGenerator.generate(length);
}

