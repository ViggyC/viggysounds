import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHOWS_DIR = path.join(ROOT, "public/media/photos/shows");
const OUT_FILE = path.join(ROOT, "src/generated/showPhotos.json");

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

function filenameToAlt(name) {
  const base = name.replace(/\.[^.]+$/i, "");
  const label = base.replace(/[_-]+/g, " ").trim() || "photo";
  return `VIGGY — ${label}`;
}

function scan() {
  if (!fs.existsSync(SHOWS_DIR)) {
    fs.mkdirSync(SHOWS_DIR, { recursive: true });
  }
  const files = fs.readdirSync(SHOWS_DIR);
  const items = files
    .filter((f) => IMAGE_RE.test(f))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    )
    .map((filename) => ({
      src: `media/photos/shows/${filename}`,
      alt: filenameToAlt(filename),
    }));
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

export function showPhotosScanPlugin() {
  return {
    name: "show-photos-scan",
    buildStart() {
      scan();
    },
    configureServer(server) {
      scan();
      server.watcher.add(SHOWS_DIR);
      const refresh = () => scan();
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
  };
}
