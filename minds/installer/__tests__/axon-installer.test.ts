import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, readFile, stat } from "fs/promises";
import { tmpdir } from "os";
import {
  getTargetTriple,
  getPinnedVersion,
  installAxon,
  type InstallOptions,
} from "../axon-installer";

describe("axon-installer", () => {
  describe("getTargetTriple", () => {
    it("returns correct triple for current platform", () => {
      const triple = getTargetTriple();
      const platform = process.platform;
      const arch = process.arch;

      if (platform === "darwin" && arch === "arm64") {
        expect(triple).toBe("aarch64-apple-darwin");
      } else if (platform === "darwin" && arch === "x64") {
        expect(triple).toBe("x86_64-apple-darwin");
      } else if (platform === "linux" && arch === "arm64") {
        expect(triple).toBe("aarch64-unknown-linux-gnu");
      } else if (platform === "linux" && arch === "x64") {
        expect(triple).toBe("x86_64-unknown-linux-gnu");
      } else {
        // On an unsupported platform, this test should still pass
        // by verifying getTargetTriple throws
        expect(() => getTargetTriple()).toThrow();
      }
    });

    it("covers all 4 platform targets", () => {
      // Test the internal mapping by importing the mapping directly
      // We verify coverage by testing with overrides
      const mappings: Array<{
        platform: string;
        arch: string;
        expected: string;
      }> = [
        {
          platform: "darwin",
          arch: "arm64",
          expected: "aarch64-apple-darwin",
        },
        {
          platform: "darwin",
          arch: "x64",
          expected: "x86_64-apple-darwin",
        },
        {
          platform: "linux",
          arch: "arm64",
          expected: "aarch64-unknown-linux-gnu",
        },
        {
          platform: "linux",
          arch: "x64",
          expected: "x86_64-unknown-linux-gnu",
        },
      ];

      for (const { platform, arch, expected } of mappings) {
        // Import the function that accepts explicit platform/arch
        const { getTargetTripleFor } = require("../axon-installer");
        expect(getTargetTripleFor(platform, arch)).toBe(expected);
      }
    });

    it("throws descriptive error for unsupported platform", () => {
      const { getTargetTripleFor } = require("../axon-installer");
      expect(() => getTargetTripleFor("win32", "x64")).toThrow(
        /unsupported platform/i
      );
    });

    it("throws descriptive error for unsupported arch", () => {
      const { getTargetTripleFor } = require("../axon-installer");
      expect(() => getTargetTripleFor("darwin", "ia32")).toThrow(
        /unsupported.*arch/i
      );
    });
  });

  describe("getPinnedVersion", () => {
    it("reads version from axon-version.json", () => {
      // Use the actual repo root where axon-version.json lives
      const installerDir = join(__dirname, "..");
      const version = getPinnedVersion(installerDir);
      expect(version).toBe("0.1.0");
    });

    it("returns null when file does not exist", () => {
      const version = getPinnedVersion("/tmp/nonexistent-dir-12345");
      expect(version).toBeNull();
    });

    it("returns null for malformed JSON", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "axon-test-"));
      try {
        await Bun.write(
          join(tempDir, "axon-version.json"),
          "not valid json"
        );
        const version = getPinnedVersion(tempDir);
        expect(version).toBeNull();
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });
  });

  describe("installAxon", () => {
    let tempDir: string;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "axon-install-"));
      originalFetch = globalThis.fetch;
    });

    afterEach(async () => {
      globalThis.fetch = originalFetch;
      await rm(tempDir, { recursive: true, force: true });
    });

    it("downloads binary and verifies checksum", async () => {
      const fakeBinary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // ELF header
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(fakeBinary);
      const expectedHash = hasher.digest("hex");

      const triple = getTargetTriple();
      const checksumContent = `${expectedHash}  axon-${triple}\n`;

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("checksums.txt")) {
          return new Response(checksumContent, { status: 200 });
        }
        if (urlStr.includes(`axon-${triple}`)) {
          return new Response(fakeBinary, { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const result = await installAxon({
        version: "0.1.0",
        targetDir: tempDir,
        repoOwner: "BrettHamlin",
        repoName: "axon",
      });

      expect(result.binaryPath).toBe(join(tempDir, "axon"));
      expect(result.version).toBe("0.1.0");
      expect(result.platform).toBe(process.platform);
      expect(result.arch).toBe(process.arch);

      // Verify binary was written
      const written = await readFile(join(tempDir, "axon"));
      expect(new Uint8Array(written)).toEqual(fakeBinary);

      // Verify executable permissions
      const stats = await stat(join(tempDir, "axon"));
      // Check that owner execute bit is set (0o100)
      expect(stats.mode & 0o100).toBeTruthy();
    });

    it("rejects on checksum mismatch", async () => {
      const fakeBinary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
      const triple = getTargetTriple();
      const checksumContent = `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  axon-${triple}\n`;

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("checksums.txt")) {
          return new Response(checksumContent, { status: 200 });
        }
        if (urlStr.includes(`axon-${triple}`)) {
          return new Response(fakeBinary, { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      await expect(
        installAxon({
          version: "0.1.0",
          targetDir: tempDir,
        })
      ).rejects.toThrow(/checksum/i);
    });

    it("rejects on download failure (404)", async () => {
      globalThis.fetch = mock(async () => {
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      await expect(
        installAxon({
          version: "0.1.0",
          targetDir: tempDir,
        })
      ).rejects.toThrow(/download.*failed|failed.*download|404/i);
    });

    it("constructs correct download URL", async () => {
      const capturedUrls: string[] = [];
      const triple = getTargetTriple();

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        capturedUrls.push(urlStr);
        // Return 404 so the test doesn't need full checksum setup
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      try {
        await installAxon({
          version: "1.2.3",
          targetDir: tempDir,
          repoOwner: "TestOwner",
          repoName: "test-repo",
        });
      } catch {
        // Expected to fail
      }

      expect(capturedUrls).toContainEqual(
        `https://github.com/TestOwner/test-repo/releases/download/v1.2.3/axon-${triple}`
      );
    });

    it("creates target directory if it does not exist", async () => {
      const nestedDir = join(tempDir, "nested", "bin");
      const fakeBinary = new Uint8Array([0xCA, 0xFE]);
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(fakeBinary);
      const expectedHash = hasher.digest("hex");
      const triple = getTargetTriple();

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("checksums.txt")) {
          return new Response(`${expectedHash}  axon-${triple}\n`, {
            status: 200,
          });
        }
        if (urlStr.includes(`axon-${triple}`)) {
          return new Response(fakeBinary, { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      }) as typeof fetch;

      const result = await installAxon({
        version: "0.1.0",
        targetDir: nestedDir,
      });

      expect(result.binaryPath).toBe(join(nestedDir, "axon"));
      const written = await readFile(join(nestedDir, "axon"));
      expect(new Uint8Array(written)).toEqual(fakeBinary);
    });
  });
});
