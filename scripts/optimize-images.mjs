import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COLLECTIONS = {
  covers: {
    directory: path.join(__dirname, "../public/media/cover-art"),
    maxSize: 800,
  },
  photos: {
    directory: path.join(__dirname, "../public/media/photos"),
    maxSize: 1920,
  },
};
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function findImages(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findImages(entryPath);
      return entry.isFile() && IMAGE_RE.test(entry.name) ? [entryPath] : [];
    });
}

async function optimizeFile(filePath, maxSize) {
  const ext = path.extname(filePath).toLowerCase();
  const before = fs.statSync(filePath).size;
  const input = sharp(filePath).rotate().resize(maxSize, maxSize, {
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
  if (buffer.length < before) fs.writeFileSync(filePath, buffer);

  return { before, after: Math.min(before, buffer.length) };
}

async function main() {
  const collectionName = process.argv[2];
  const collection = COLLECTIONS[collectionName];
  if (!collection) {
    throw new Error(
      `Choose an image collection: ${Object.keys(COLLECTIONS).join(", ")}`,
    );
  }

  if (!fs.existsSync(collection.directory)) {
    throw new Error(`Image directory not found: ${collection.directory}`);
  }

  const files = findImages(collection.directory);
  if (files.length === 0) {
    console.log(`No ${collectionName} images found.`);
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;

  for (const filePath of files) {
    const result = await optimizeFile(filePath, collection.maxSize);
    if (!result) continue;

    totalBefore += result.before;
    totalAfter += result.after;
    const savings = ((1 - result.after / result.before) * 100).toFixed(0);
    console.log(
      `${path.relative(collection.directory, filePath)}: ${formatBytes(result.before)} → ${formatBytes(result.after)} (${savings}% smaller)`,
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
