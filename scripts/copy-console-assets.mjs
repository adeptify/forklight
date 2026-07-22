import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src", "console", "public");
const dest = path.join(root, "dist", "src", "console", "public");

const files = ["index.html", "app.css", "app.js"];

await mkdir(dest, { recursive: true });
for (const f of files) {
  await copyFile(path.join(src, f), path.join(dest, f));
  console.log(`  console: ${f} → dist/src/console/public/${f}`);
}
console.log("Console assets packaged.");
