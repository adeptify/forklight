import { readFile, writeFile } from "node:fs/promises";

const counterPath = ".verify-count";
let count = 0;
try {
  count = Number.parseInt(await readFile(counterPath, "utf8"), 10) || 0;
} catch {
  // First verification in this isolated workspace.
}
count += 1;
await writeFile(counterPath, `${count}\n`, "utf8");

let feature = "";
try {
  feature = await readFile("feature.txt", "utf8");
} catch {
  console.error("feature.txt is missing");
  process.exit(1);
}

if (feature !== "candidate reuse works\n") {
  console.error("feature.txt does not contain the accepted result");
  process.exit(1);
}

// The first actual acceptance invocation fails once. The retained workspace
// keeps the counter, so a Main-authorized correction's later invocation can
// pass without changing the accepted candidate output.
if (count === 1) {
  console.error("dogfood: simulated one-time acceptance failure");
  process.exit(1);
}

console.log(`candidate reuse fixture passed on verification invocation ${count}`);
