// Shared helpers for all scripts: env loading, provider, wallets, tx printing.
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";

export const ROOT = path.join(__dirname, "..");
export const ENV_PATH = path.join(ROOT, ".env");

dotenv.config({ path: ENV_PATH });

// NETWORK=mst (default) uses MST Testnet; NETWORK=local uses `npx hardhat node`.
export const NETWORK = (process.env.NETWORK || "mst").trim().toLowerCase();
export const IS_LOCAL = NETWORK === "local";

export const RPC_URL = IS_LOCAL
  ? process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545"
  : process.env.RPC_URL || "https://testnetrpc.mstblockchain.com";
export const CHAIN_ID = IS_LOCAL ? 31337 : Number(process.env.CHAIN_ID || 91562037);
export const EXPLORER_URL = IS_LOCAL
  ? "" // no explorer for the local node
  : (process.env.EXPLORER_URL || "https://testnet.mstscan.com").replace(/\/$/, "");

// cacheTimeout: -1 turns off ethers' 250 ms request cache. Without this, a tx sent right
// after another one is mined can reuse a stale nonce ("nonce has already been used").
export const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 });

export const txUrl = (hash: string) => (EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : "(local network - no explorer)");
export const addressUrl = (addr: string) =>
  EXPLORER_URL ? `${EXPLORER_URL}/address/${addr}` : "(local network - no explorer)";

/** Paths for deployment output (shared with the keeper and frontend). */
export const DEPLOYMENT_PATH = path.join(ROOT, "deployment.json");
export const ABI_PATH = path.join(ROOT, "abi", "LegacyVault.json");
export const ARTIFACT_PATH = path.join(ROOT, "artifacts", "contracts", "LegacyVault.sol", "LegacyVault.json");

/** State enum names, same order as the contract (single source: agent/stateMachine.ts). */
export { STATE_NAMES } from "../agent/stateMachine";

/** Read the compiled Hardhat artifact (abi + bytecode). */
export function loadArtifact(): { abi: any[]; bytecode: string } {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    console.error("Contract not compiled. Run: npx hardhat compile");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
}

/**
 * Turn a failed call into the contract's custom error name, e.g. "DeadlineNotPassed()".
 * The wallet's gas estimate fails without knowing our ABI, so we decode the raw revert data here.
 */
export function decodeRevert(e: any, iface: ethers.Interface): { name: string | null; text: string } {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return { name: parsed.name, text: `${parsed.name}(${parsed.args.join(", ")})` };
    } catch {
      /* not one of our errors */
    }
  }
  return { name: null, text: e?.shortMessage || e?.message || String(e) };
}

/** Contract instance at CONTRACT_ADDRESS, connected to a signer or the read-only provider. */
export function getVault(runner: ethers.ContractRunner = provider): ethers.Contract {
  return new ethers.Contract(requireEnv("CONTRACT_ADDRESS"), loadArtifact().abi, runner);
}

/** Read a required env var or exit with a clear message (never prints the value). */
export function requireEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
  return v;
}

/** Wallet for one of the *_PRIVATE_KEY entries, connected to MST. */
export function walletFromEnv(name: string): ethers.Wallet {
  return new ethers.Wallet(requireEnv(name), provider);
}

/**
 * MST reports baseFee = 0 and no EIP-1559 fee suggestions, so we always send
 * legacy (type 0) transactions with an explicit gasPrice.
 */
export async function txOverrides(): Promise<{ type: number; gasPrice: bigint }> {
  const fee = await provider.getFeeData();
  return { type: 0, gasPrice: fee.gasPrice ?? ethers.parseUnits("1", "gwei") };
}

/** Wait for a tx to be mined and print hash, block, gas, status, explorer link. */
export async function waitAndPrint(label: string, tx: ethers.TransactionResponse) {
  console.log(`\n[TX] ${label}`);
  console.log(`  hash:     ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("No receipt returned");
  console.log(`  block:    ${receipt.blockNumber}`);
  console.log(`  gasUsed:  ${receipt.gasUsed.toString()}`);
  console.log(`  status:   ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);
  console.log(`  explorer: ${txUrl(tx.hash)}`);
  return receipt;
}

/**
 * Set KEY=value in .env. If onlyIfEmpty is true, an existing non-empty value is kept.
 * Returns true if the file was changed. Comments and other lines are preserved.
 */
export function setEnvValue(key: string, value: string, onlyIfEmpty: boolean): boolean {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const match = text.match(re);

  if (match) {
    const current = match[1].split("#")[0].trim();
    if (onlyIfEmpty && current) return false;
    text = text.replace(re, `${key}=${value}`);
  } else {
    text += (text.endsWith("\n") || text === "" ? "" : "\n") + `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, text);
  process.env[key] = value;
  return true;
}
