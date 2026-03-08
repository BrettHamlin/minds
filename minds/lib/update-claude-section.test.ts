import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateSection } from "./update-claude-section";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "update-claude-section-tests");

function tmpFile(name: string): string {
  return join(TMP, name);
}

function write(name: string, content: string): string {
  mkdirSync(TMP, { recursive: true });
  const p = tmpFile(name);
  writeFileSync(p, content, "utf8");
  return p;
}

function read(name: string): string {
  return readFileSync(tmpFile(name), "utf8");
}

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("updateSection", () => {
  it("replaces an existing section in the middle of a file", () => {
    const p = write(
      "middle.md",
      [
        "## First Section",
        "first content",
        "",
        "## Active Mind Review",
        "old content line 1",
        "old content line 2",
        "",
        "## Last Section",
        "last content",
      ].join("\n") + "\n"
    );

    updateSection(p, "## Active Mind Review", "## Active Mind Review\nnew content\n");

    const result = read("middle.md");
    expect(result).toContain("## Active Mind Review\nnew content");
    expect(result).not.toContain("old content");
    expect(result).toContain("## First Section");
    expect(result).toContain("## Last Section");
  });

  it("removes an existing section in the middle of a file", () => {
    const p = write(
      "remove-middle.md",
      [
        "## First Section",
        "first content",
        "",
        "## Active Mind Review",
        "review line 1",
        "review line 2",
        "",
        "## Last Section",
        "last content",
      ].join("\n") + "\n"
    );

    updateSection(p, "## Active Mind Review");

    const result = read("remove-middle.md");
    expect(result).not.toContain("## Active Mind Review");
    expect(result).not.toContain("review line");
    expect(result).toContain("## First Section");
    expect(result).toContain("## Last Section");
  });

  it("handles section at end of file (no ## heading after it)", () => {
    const p = write(
      "end-of-file.md",
      [
        "## Preamble",
        "some preamble",
        "",
        "## Active Mind Review",
        "review content here",
        "more review content",
      ].join("\n") + "\n"
    );

    // Replace when section is the last one
    updateSection(
      p,
      "## Active Mind Review",
      "## Active Mind Review\nupdated review content\n"
    );

    const result = read("end-of-file.md");
    expect(result).toContain("updated review content");
    expect(result).not.toContain("review content here");
    expect(result).toContain("## Preamble");

    // Remove when section is the last one
    updateSection(p, "## Active Mind Review");

    const afterRemove = read("end-of-file.md");
    expect(afterRemove).not.toContain("## Active Mind Review");
    expect(afterRemove).not.toContain("updated review content");
    expect(afterRemove).toContain("## Preamble");
  });

  it("appends new content when section is not found", () => {
    const p = write(
      "no-section.md",
      ["## Existing Section", "existing content"].join("\n") + "\n"
    );

    updateSection(
      p,
      "## Active Mind Review",
      "## Active Mind Review\nappended content\n"
    );

    const result = read("no-section.md");
    expect(result).toContain("## Existing Section");
    expect(result).toContain("## Active Mind Review\nappended content");
  });

  it("creates the file and parent directories when file does not exist", () => {
    const p = join(TMP, "nested", "deep", "new-file.md");
    expect(existsSync(p)).toBe(false);

    updateSection(p, "## Active Mind Review", "## Active Mind Review\nbrand new\n");

    expect(existsSync(p)).toBe(true);
    const result = readFileSync(p, "utf8");
    expect(result).toContain("## Active Mind Review\nbrand new");
  });

  it("does nothing when removing a section that does not exist", () => {
    const p = write("no-op.md", "## Only Section\nsome content\n");

    updateSection(p, "## Active Mind Review");

    expect(read("no-op.md")).toBe("## Only Section\nsome content\n");
  });

  it("does nothing when removing from a non-existent file", () => {
    const p = tmpFile("ghost.md");
    expect(existsSync(p)).toBe(false);

    updateSection(p, "## Active Mind Review");

    expect(existsSync(p)).toBe(false);
  });
});
