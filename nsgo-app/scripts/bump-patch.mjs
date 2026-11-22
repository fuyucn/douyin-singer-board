import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function bumpPatch(version) {
  const edition = /^(\d+\.\d+\.\d+)-(susu|preview)\.(\d+)$/.exec(version);
  if (edition) return edition[1] + "-" + edition[2] + "." + (Number(edition[3]) + 1);
  const legacy = /^(\d+\.\d+\.\d+)-(\d+)$/.exec(version);
  if (legacy) return legacy[1] + "-" + (Number(legacy[2]) + 1);
  const plain = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!plain) throw new Error("Invalid version; expected x.y.z, x.y.z-N, x.y.z-susu.N or x.y.z-preview.N");
  return plain[1] + "." + plain[2] + "." + (Number(plain[3]) + 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = new URL("../nsgo.yaml", import.meta.url);
  const manifest = readFileSync(path, "utf8");
  const matches = [...manifest.matchAll(/^version:\s*([^\s]+)\s*$/gm)];
  if (matches.length !== 1) throw new Error("Expected one canonical manifest version");
  const current = matches[0][1];
  const next = bumpPatch(current);
  if (process.argv.includes("--check")) console.log(current);
  else {
    writeFileSync(path, manifest.replace(/^version:.*$/m, "version: " + next));
    console.log(current + " -> " + next);
  }
}
