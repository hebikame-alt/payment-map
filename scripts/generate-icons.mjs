// Renders public/icon.svg to the PNG sizes referenced from index.html.
// Usage: node scripts/generate-icons.mjs
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url));

const outputs = [
  { size: 180, file: "apple-touch-icon.png" },
  { size: 32, file: "favicon-32x32.png" },
  { size: 512, file: "icon-512x512.png" },
];

for (const { size, file } of outputs) {
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url)));
  console.log(`public/${file} (${size}x${size})`);
}
