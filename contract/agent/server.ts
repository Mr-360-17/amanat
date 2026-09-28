// Express API + keeper in one process.  Run: npm run agent
//   GET  /agent/status   heartbeat + ONLINE/OFFLINE
//   GET  /notifications  latest 50 (newest first)
//   GET  /contract       address, chainId, rpcUrl, explorer, deployBlock, abi
//   POST /vault/hash     { vaultHash } + header x-api-key -> keeper stores it on-chain
import * as crypto from "crypto";
import express from "express";
import cors from "cors";
import {
  NETWORK,
  CHAIN_ID,
  RPC_URL,
  EXPLORER_URL,
  CONTRACT_ADDRESS,
  DEPLOY_BLOCK,
  ABI,
  API_PORT,
  BACKEND_API_KEY,
  CHECK_INTERVAL_SECONDS,
  FRONTEND_ORIGINS,
} from "./config";
import { startKeeper, storeVaultHash, ContractRefused } from "./keeper";
import { latestNotifications, readHeartbeat, notify } from "./notifier";

const app = express();
app.use(cors({ origin: FRONTEND_ORIGINS }));
app.use(express.json({ limit: "10kb" }));

app.get("/agent/status", (_req, res) => {
  const hb = readHeartbeat();
  const ageMs = hb?.lastCheckMs ? Date.now() - hb.lastCheckMs : null;
  // ONLINE if the last successful check was less than 3 intervals ago
  const online = ageMs !== null && ageMs < 3 * CHECK_INTERVAL_SECONDS * 1000;
  res.json({ status: online ? "ONLINE" : "OFFLINE", secondsSinceLastCheck: ageMs === null ? null : Math.round(ageMs / 1000), ...hb });
});

app.get("/notifications", (_req, res) => {
  res.json(latestNotifications(50));
});

app.get("/contract", (_req, res) => {
  res.json({
    network: NETWORK,
    address: CONTRACT_ADDRESS,
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    explorer: EXPLORER_URL || null,
    deployBlock: DEPLOY_BLOCK,
    abi: ABI,
  });
});

/** Constant-time API key comparison. */
function validApiKey(given: unknown): boolean {
  if (!BACKEND_API_KEY || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(BACKEND_API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

app.post("/vault/hash", async (req, res) => {
  if (!BACKEND_API_KEY) return res.status(503).json({ error: "BACKEND_API_KEY is not configured on the server" });
  if (!validApiKey(req.header("x-api-key"))) return res.status(401).json({ error: "Invalid or missing x-api-key" });

  const vaultHash = req.body?.vaultHash;
  if (typeof vaultHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(vaultHash)) {
    return res.status(400).json({ error: "vaultHash must be 0x followed by 64 hex characters (bytes32)" });
  }
  if (/^0x0{64}$/.test(vaultHash)) return res.status(400).json({ error: "vaultHash must not be zero" });

  try {
    // Waits up to 60s if the keeper is already sending another tx
    const result = await storeVaultHash(vaultHash, 60_000);
    if (result.status === "SUCCESS") {
      notify({ type: "hash", title: "🔏 VAULT HASH STORED", message: `New vault hash ${vaultHash.slice(0, 10)}... stored on-chain.`, txHash: result.hash, explorerUrl: result.explorerUrl });
    }
    return res.status(result.status === "SUCCESS" ? 200 : 500).json({ vaultHash, ...result });
  } catch (e: any) {
    if (e instanceof ContractRefused) return res.status(409).json({ error: `Contract refused: ${e.message}` });
    if (e?.message === "KEEPER_BUSY") return res.status(503).json({ error: "Keeper is busy with another transaction, try again shortly" });
    console.log(`[api] /vault/hash failed: ${e?.shortMessage || e?.message}`);
    return res.status(502).json({ error: "Transaction failed", detail: e?.shortMessage || e?.message });
  }
});

app.listen(API_PORT, () => {
  console.log(`[api] listening on http://localhost:${API_PORT}  (CORS: ${FRONTEND_ORIGINS.join(", ")})`);
  startKeeper();
});
