// Creates throwaway testnet wallets and writes their keys into .env.
// - Never overwrites a key that is already set.
// - Prints ADDRESSES only, never private keys.
// Run: npx tsx scripts/generate-wallets.ts
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { ENV_PATH, ROOT, setEnvValue } from "./common";

const ROLES = [
  { key: "OWNER_PRIVATE_KEY", label: "Owner" },
  { key: "KEEPER_PRIVATE_KEY", label: "Keeper (agent)" },
  { key: "CONTACT1_PRIVATE_KEY", label: "Trusted contact 1" },
  { key: "CONTACT2_PRIVATE_KEY", label: "Trusted contact 2" },
  { key: "CONTACT3_PRIVATE_KEY", label: "Trusted contact 3" },
];

function main() {
  // Start from .env.example if there is no .env yet
  if (!fs.existsSync(ENV_PATH)) {
    fs.copyFileSync(path.join(ROOT, ".env.example"), ENV_PATH);
    console.log("Created .env from .env.example");
  }

  console.log("\n=== LegacyVault dev wallets (MST Testnet, throwaway only) ===\n");

  for (const role of ROLES) {
    const created = setEnvValue(role.key, ethers.Wallet.createRandom().privateKey, true);
    // Re-read whatever key is now in .env (new or pre-existing) to show its address
    const address = new ethers.Wallet(process.env[role.key]!).address;
    console.log(`${role.label.padEnd(18)} ${address}  ${created ? "(new)" : "(kept existing)"}`);
  }

  // Beneficiaries only need addresses (they never send txs), so no keys are stored
  const benCreated = setEnvValue(
    "BENEFICIARY_ADDRESSES",
    [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address].join(","),
    true
  );
  console.log(
    `${"Beneficiaries".padEnd(18)} ${process.env.BENEFICIARY_ADDRESSES}  ${benCreated ? "(new)" : "(kept existing)"}`
  );

  // Shared secret for POST /vault/hash (not printed; give it to the backend teammate privately)
  const apiKeyCreated = setEnvValue("BACKEND_API_KEY", ethers.hexlify(ethers.randomBytes(24)), true);
  console.log(`\nBACKEND_API_KEY ${apiKeyCreated ? "generated" : "already set"} (value not printed)`);

  console.log("\nKeys were written to .env only. Fund the OWNER address at https://faucet.mstblockchain.com/");
}

main();
