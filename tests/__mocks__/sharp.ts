/**
 * Manual mock for the `sharp` image-processing library.
 *
 * Wired via vitest.config.ts → resolve.alias so that every dynamic
 * `await import("sharp")` in Node test runs returns this stub instead
 * of the native binary.
 *
 * Methods return `this` for chaining. `toBuffer` resolves with an object
 * that has { data, info } — matching the resolveWithObject=true shape.
 * Individual tests can override via `vi.mocked(sharp)`.
 */

import { vi } from "vitest";

export type MockSharpInstance = {
  metadata: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  jpeg: ReturnType<typeof vi.fn>;
  png: ReturnType<typeof vi.fn>;
  toBuffer: ReturnType<typeof vi.fn>;
};

function makeMockSharpInstance(): MockSharpInstance {
  const inst: MockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
    rotate:   vi.fn(),
    resize:   vi.fn(),
    jpeg:     vi.fn(),
    png:      vi.fn(),
    toBuffer: vi.fn().mockImplementation(
      async (opts?: { resolveWithObject?: boolean }) => {
        const data = Buffer.alloc(20_000).fill(1);
        if (opts?.resolveWithObject) {
          return { data, info: { width: 1280, height: 720, channels: 3 } };
        }
        return data;
      },
    ),
  };
  inst.rotate.mockReturnValue(inst);
  inst.resize.mockReturnValue(inst);
  inst.jpeg.mockReturnValue(inst);
  inst.png.mockReturnValue(inst);
  return inst;
}

/** Shared singleton instance — tests can configure via vi.mocked(sharp). */
export const sharedInstance = makeMockSharpInstance();

const sharpMock = vi.fn().mockImplementation(() => sharedInstance);

export default sharpMock;
