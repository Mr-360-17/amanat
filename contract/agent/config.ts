// Keeper + API settings. Network, provider and wallet helpers are shared with scripts/.
import * as fs from "fs";
import * as path from "path";
import {
  NETWORK,
  CHAIN_ID,
  RPC_URL,
  EXPLORER_URL,
  DEPLOYMENT_PATH,
  provider,
  requireEnv,
  walletFromEnv,
  loadArtifact,
} from "../scripts/common";

export { NETWORK, CHAIN_ID, RPC_URL, EXPLORER_URL, provider };
export { txUrl, txOverrides, decodeRevert } from "../scripts/common";

export const CHECK_INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS || 5);
export const API_PORT = Number(process.env.API_PORT || 4000);
export const BACKEND_API_KEY = (process.env.BACKEND_API_KEY || "").trim();

// Vite dev server origins allowed to call the API
export const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim());

export const DATA_DIR = path.join(__dirname, "data");
export const HEARTBEAT_PATH = path.join(DATA_DIR, "heartbeat.json");
export const NOTIFICATIONS_PATH = path.join(DATA_DIR, "notifications.json");

export const CONTRACT_ADDRESS = requireEnv("CONTRACT_ADDRESS");
export const ABI = loadArtifact().abi;

/** deployBlock from .env, falling back to deployment.json. */
export const DEPLOY_BLOCK = (() => {
  const fromEnv = Number(process.env.DEPLOY_BLOCK || 0);
  if (fromEnv) return fromEnv;
  if (fs.existsSync(DEPLOYMENT_PATH)) return Number(JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8")).deployBlock);
  return 0;
})();

/** The keeper wallet signs startGrace / release / storeVaultHash. Key stays in memory only. */
export const keeperWallet = walletFromEnv("KEEPER_PRIVATE_KEY");
