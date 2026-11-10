import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  BASE62_ALPHABET,
  CryptoCodeGenerator,
  DeterministicCodeGenerator,
  generateCode,
  REJECTION_THRESHOLD,
} from "./index.js";

describe("CryptoCodeGenerator", () => {
  it("generates default 8-character Base62 string", () => {
    const code = generateCode();
    expect(code).toHaveLength(8);
    for (const char of code) {
      expect(BASE62_ALPHABET).toContain(char);
    }
  });

  it("generates code of custom requested length", () => {
    const generator = new CryptoCodeGenerator();
    for (const len of [1, 4, 8, 12, 16, 32]) {
      const code = generator.generate(len);
      expect(code).toHaveLength(len);
    }
  });

  it("throws on invalid length (0 or negative)", () => {
    const generator = new CryptoCodeGenerator();
    expect(() => generator.generate(0)).toThrow(RangeError);
    expect(() => generator.generate(-5)).toThrow(RangeError);
  });

  it("generates unique codes across 10,000 samples", () => {
    const generator = new CryptoCodeGenerator(8);
    const set = new Set<string>();
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      set.add(generator.generate());
    }
    // With 62^8 keyspace, seeing 0 collisions across 10k items has > 99.999% probability
    expect(set.size).toBe(count);
  });

  it("ensures rejection threshold is exact multiple of 62", () => {
    expect(REJECTION_THRESHOLD % 62).toBe(0);
    expect(256 - REJECTION_THRESHOLD).toBe(8); // Only 8 biased values rejected
  });

  // Property-based test with fast-check
  it("invariantly satisfies alphabet and length constraints (property-based)", () => {
    const generator = new CryptoCodeGenerator();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (length) => {
        const code = generator.generate(length);
        if (code.length !== length) return false;
        for (let i = 0; i < code.length; i++) {
          if (!BASE62_ALPHABET.includes(code[i] as any)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe("DeterministicCodeGenerator", () => {
  it("cycles predictably through sequence to simulate collisions", () => {
    const sequence = ["COLLIDE1", "COLLIDE1", "UNIQUE01"];
    const generator = new DeterministicCodeGenerator(sequence);

    expect(generator.generate()).toBe("COLLIDE1");
    expect(generator.generate()).toBe("COLLIDE1");
    expect(generator.generate()).toBe("UNIQUE01");
    expect(generator.generate()).toBe("COLLIDE1"); // cycles
  });

  it("throws on empty sequence", () => {
    expect(() => new DeterministicCodeGenerator([])).toThrow();
  });
});

