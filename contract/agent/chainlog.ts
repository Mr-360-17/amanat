// Reads LegacyVault events from the chain for the team backend's /txlog.
// Scans from DEPLOY_BLOCK in chunks (RPC log-range limits), then only new blocks.
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS, DEPLOY_BLOCK, provider, txUrl } from "./config";

export interface ChainEvent {
  name: string; // contract event name, e.g. "CheckIn"
  args: ethers.Result;
  txHash: string;
  block: number;
  logIndex: number;
  timestamp: number; // block time (s)
}

const CHUNK = 5000;
const MIN_REFRESH_MS = 4000; // don't rescan more often than this

const readVault = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
const events: ChainEvent[] = [];
const blockTimes = new Map<number, number>();
let scannedTo = DEPLOY_BLOCK - 1;
let lastRefresh = 0;
let running: Promise<void> | null = null;

async function scan() {
  const latest = await provider.getBlockNumber();
  for (let from = scannedTo + 1; from <= latest; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, latest);
    const logs = await readVault.queryFilter("*", from, to);
    const found: ChainEvent[] = [];
    for (const log of logs) {
      if (!("eventName" in log)) continue;
      if (!blockTimes.has(log.blockNumber)) {
        blockTimes.set(log.blockNumber, (await provider.getBlock(log.blockNumber))?.timestamp ?? 0);
      }
      found.push({
        name: log.eventName,
        args: log.args,
        txHash: log.transactionHash,
        block: log.blockNumber,
        logIndex: log.index,
        timestamp: blockTimes.get(log.blockNumber)!,
      });
    }
    events.push(...found); // only after the whole chunk succeeded
    scannedTo = to;
  }
}

/** All vault events, oldest first. Rescans at most every few seconds; concurrent callers share one scan. */
export async function getEvents(): Promise<ChainEvent[]> {
  if (Date.now() - lastRefresh > MIN_REFRESH_MS) {
    if (!running) {
      running = scan()
        .then(() => {
          lastRefresh = Date.now();
        })
        .finally(() => {
          running = null;
        });
    }
    await running;
  }
  return events;
}

export const explorerTx = (hash: string) => (txUrl(hash).startsWith("http") ? txUrl(hash) : null);
