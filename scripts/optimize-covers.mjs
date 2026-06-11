import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = path.join(__dirname, "../public/media/cover-art");
const MAX_SIZE = 800;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function optimizeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const before = fs.statSync(filePath).size;
  const input = sharp(filePath).rotate().resize(MAX_SIZE, MAX_SIZE, {
    fit: "inside",
    withoutEnlargement: true,
  });

  let output;
  if (ext === ".jpg" || ext === ".jpeg") {
    output = input.jpeg({ quality: 82, mozjpeg: true });
  } else if (ext === ".png") {
    output = input.png({ compressionLevel: 9, palette: true });
  } else if (ext === ".webp") {
    output = input.webp({ quality: 82 });
  } else {
    return null;
  }

  const buffer = await output.toBuffer();
  fs.writeFileSync(filePath, buffer);
  const after = buffer.length;

  return { before, after };
}

async function main() {
  if (!fs.existsSync(COVERS_DIR)) {
    console.error(`Cover art directory not found: ${COVERS_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(COVERS_DIR)
    .filter((f) => IMAGE_RE.test(f))
    .sort();

  if (files.length === 0) {
    console.log("No cover art images found.");
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;

  for (const filename of files) {
    const filePath = path.join(COVERS_DIR, filename);
    const result = await optimizeFile(filePath);
    if (!result) continue;

    totalBefore += result.before;
    totalAfter += result.after;
    const savings = ((1 - result.after / result.before) * 100).toFixed(0);
    console.log(
      `${filename}: ${formatBytes(result.before)} → ${formatBytes(result.after)} (${savings}% smaller)`,
    );
  }

  const totalSavings = ((1 - totalAfter / totalBefore) * 100).toFixed(0);
  console.log(
    `\nTotal: ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (${totalSavings}% smaller)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
