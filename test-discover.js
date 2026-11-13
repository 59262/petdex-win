import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PETDEX_DIR = join(homedir(), ".petdex");
const roots = [
  join(PETDEX_DIR, "pets"),
  join(homedir(), ".codex", "pets"),
];

console.log("Scanning for pets...");
for (const root of roots) {
  console.log(`\nRoot: ${root}`);
  console.log(`Exists: ${existsSync(root)}`);
  if (!existsSync(root)) continue;

  const entries = readdirSync(root);
  console.log(`Entries: ${entries.join(", ")}`);

  for (const slug of entries) {
    const dir = join(root, slug);
    console.log(`\n  Checking: ${slug}`);
    for (const ext of ["webp", "png"]) {
      const spritePath = join(dir, `spritesheet.${ext}`);
      console.log(`    spritesheet.${ext}: ${existsSync(spritePath)}`);
      if (existsSync(spritePath)) {
        let displayName = slug;
        const petJsonPath = join(dir, "pet.json");
        if (existsSync(petJsonPath)) {
          try {
            const pj = JSON.parse(readFileSync(petJsonPath, "utf8"));
            if (pj.displayName) displayName = pj.displayName;
          } catch (e) {
            console.log(`    Error reading pet.json: ${e.message}`);
          }
        }
        console.log(`    Found pet: ${displayName} (${slug})`);
        break;
      }
    }
  }
}
