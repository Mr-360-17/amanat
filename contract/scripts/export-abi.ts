// Writes abi/LegacyVault.json from the compiled artifact (ABI only, no bytecode).
// Used by deploy.ts; can also be run on its own after `npx hardhat compile`:
//   npx tsx scripts/export-abi.ts
import * as fs from "fs";
import * as path from "path";
import { ABI_PATH, loadArtifact } from "./common";

export function exportAbi() {
  const { abi } = loadArtifact();
  fs.mkdirSync(path.dirname(ABI_PATH), { recursive: true });
  fs.writeFileSync(ABI_PATH, JSON.stringify(abi, null, 2));
  console.log(`ABI written to abi/LegacyVault.json (${abi.length} entries)`);
}

// Only run when called directly, not when imported by deploy.ts
if (require.main === module) {
  exportAbi();
}
