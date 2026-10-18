import { File, FileCode, FileImage, Folder, FolderOpen, Lock, Package } from "lucide-react";
import { describe, expect, it } from "vitest";
import { fileIcon, folderIcon } from "./fileIcon";

describe("fileIcon", () => {
  it("picks an icon and colour by extension", () => {
    expect(fileIcon("app.ts")).toEqual({ Icon: FileCode, className: "text-file-ts" });
    expect(fileIcon("main.js").className).toBe("text-file-js");
    expect(fileIcon("IMG.PNG")).toEqual({ Icon: FileImage, className: "text-file-image" });
  });

  it("knows special names before extensions", () => {
    expect(fileIcon("package.json").Icon).toBe(Package);
    expect(fileIcon("pnpm-lock.yaml").Icon).toBe(Lock);
    expect(fileIcon("README.md").className).toBe("text-file-md");
    expect(fileIcon(".env.local").className).toBe("text-file-config");
  });

  it("leaves anything else a plain grey file", () => {
    expect(fileIcon("notes.unknown")).toEqual({ Icon: File, className: "text-ink-3" });
    expect(fileIcon("Makefile")).toEqual({ Icon: File, className: "text-ink-3" });
    expect(fileIcon(".hidden")).toEqual({ Icon: File, className: "text-ink-3" });
  });

  it("draws folders in blue, open or closed", () => {
    expect(folderIcon(false)).toEqual({ Icon: Folder, className: "text-file-folder" });
    expect(folderIcon(true).Icon).toBe(FolderOpen);
  });
});
