import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src", "hub", "public");
const dest = path.join(root, "dist", "src", "hub", "public");

const files = ["index.html", "app.css", "app.js", "i18n.js"];

await mkdir(dest, { recursive: true });
for (const f of files) {
  await copyFile(path.join(src, f), path.join(dest, f));
  console.log(`  hub: ${f} -> dist/src/hub/public/${f}`);
}
console.log("Hub assets packaged.");
