import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const platform = readArg("--platform") ?? process.platform;
const binName = platform === "win32" ? "notebook-api.exe" : "notebook-api";

const candidates = [
  readArg("--binary"),
  platform === "win32"
    ? path.join(repoRoot, "target/x86_64-pc-windows-msvc/release", binName)
    : undefined,
  path.join(repoRoot, "target/release", binName),
].filter(Boolean);

const source = candidates.find((candidate) => fs.existsSync(candidate));

if (!source) {
  console.error("Could not find notebook-api binary. Tried:");
  for (const candidate of candidates) {
    console.error(`  - ${candidate}`);
  }
  console.error("\nBuild it first, for example:");
  console.error("  cargo build --release -p notebook-api");
  process.exit(1);
}

const destDir = path.join(desktopDir, "electron-resources/bin");
const dest = path.join(destDir, binName);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);

if (platform !== "win32") {
  fs.chmodSync(dest, 0o755);
}

console.log(`Copied ${source} -> ${dest}`);
