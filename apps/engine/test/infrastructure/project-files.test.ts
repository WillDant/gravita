import { describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectFiles } from "../../src/application/usecases/project-files";
import {
  FileConflictError,
  FileNotFoundError,
  InvalidCwdError,
  PathOutsideRootError,
} from "../../src/domain/errors";
import { NodeFileTree } from "../../src/infrastructure/system/node-file-tree";
import { NodeWorkspace } from "../../src/infrastructure/system/node-workspace";
import { withTempDir } from "../helpers";

// The file explorer: ProjectFiles over NodeFileTree on real folders in temp dirs.

const files = () => new ProjectFiles({ workspace: new NodeWorkspace(), files: new NodeFileTree() });

async function project(tmp: string): Promise<string> {
  const root = join(tmp, "proj");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "b.txt"), "b");
  await writeFile(join(root, "A.md"), "# a");
  await writeFile(join(root, "src", "main.ts"), "export {};\n");
  return root;
}

describe("ProjectFiles.list", () => {
  test("folders first, then files, by name; .git left out", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      const { entries } = await files().list({ root, path: "" });
      expect(entries).toEqual([
        { name: "src", kind: "dir" },
        { name: "A.md", kind: "file" },
        { name: "b.txt", kind: "file" },
      ]);
      expect((await files().list({ root, path: "src" })).entries).toEqual([
        { name: "main.ts", kind: "file" },
      ]);
    }));

  test("a missing root is an invalid folder", async () => {
    await expect(files().list({ root: "/nope/nowhere", path: "" })).rejects.toBeInstanceOf(
      InvalidCwdError,
    );
  });

  test("refuses .. and absolute paths", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      await expect(files().list({ root, path: ".." })).rejects.toBeInstanceOf(PathOutsideRootError);
      await expect(files().list({ root, path: "src/../../" })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
      await expect(files().read({ root, path: "/etc/hosts" })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
    }));

  test("refuses a symlink that leads outside", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      await writeFile(join(tmp, "secret.txt"), "s");
      await symlink(join(tmp, "secret.txt"), join(root, "link.txt"));
      await expect(files().read({ root, path: "link.txt" })).rejects.toBeInstanceOf(
        PathOutsideRootError,
      );
    }));
});

describe("ProjectFiles.read", () => {
  test("reads text with its mtime", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      const r = await files().read({ root, path: "src/main.ts" });
      expect(r).toEqual({
        kind: "text",
        text: "export {};\n",
        mtimeMs: (await stat(join(root, "src/main.ts"))).mtimeMs,
      });
    }));

  test("tells binary files apart", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      await writeFile(join(root, "img.bin"), new Uint8Array([0x89, 0x50, 0, 1]));
      expect(await files().read({ root, path: "img.bin" })).toEqual({ kind: "binary" });
    }));

  test("a missing file or a folder is not found", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      await expect(files().read({ root, path: "gone.ts" })).rejects.toBeInstanceOf(
        FileNotFoundError,
      );
      await expect(files().read({ root, path: "src" })).rejects.toBeInstanceOf(FileNotFoundError);
    }));
});

describe("ProjectFiles.write", () => {
  test("saves and returns the new mtime", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      const before = await files().read({ root, path: "b.txt" });
      if (before.kind !== "text") throw new Error("expected text");
      const { mtimeMs } = await files().write({
        root,
        path: "b.txt",
        text: "changed",
        expectedMtimeMs: before.mtimeMs,
      });
      expect(await readFile(join(root, "b.txt"), "utf8")).toBe("changed");
      expect(mtimeMs).toBe((await stat(join(root, "b.txt"))).mtimeMs);
    }));

  test("refuses when the file changed on disk since it was read", () =>
    withTempDir(async (tmp) => {
      const root = await project(tmp);
      const before = await files().read({ root, path: "b.txt" });
      if (before.kind !== "text") throw new Error("expected text");
      const later = new Date(before.mtimeMs + 5_000);
      await utimes(join(root, "b.txt"), later, later);
      await expect(
        files().write({ root, path: "b.txt", text: "x", expectedMtimeMs: before.mtimeMs }),
      ).rejects.toBeInstanceOf(FileConflictError);
      expect(await readFile(join(root, "b.txt"), "utf8")).toBe("b");
    }));
});
