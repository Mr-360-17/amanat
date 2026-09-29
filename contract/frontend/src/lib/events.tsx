// Contract event history, shared by /txlog and /protection.
// Scans from DEPLOY_BLOCK in chunks (RPCs limit log ranges), then only new blocks every 10 s.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { EventLog } from "ethers";
import { DEPLOY_BLOCK, LOG_CHUNK_BLOCKS, TXLOG_POLL_MS, txUrl } from "../config";
import { readProvider, readVault } from "./vault";

export interface LogRow {
  id: string; // txHash:logIndex
  time: number; // block timestamp (s)
  event: string;
  action: string; // human label
  txHash: string;
  block: number;
  logIndex: number;
  explorerUrl: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  CheckIn: "Owner check-in",
  BeneficiariesUpdated: "Beneficiaries updated",
  TrustedContactsUpdated: "Trusted contacts updated",
  GraceStarted: "Grace period started",
  TrustedContactConfirmed: "Trusted contact confirmed",
  DeathConfirmed: "Death confirmed (2 of 3)",
  VaultReleased: "Vault released",
  VaultCancelled: "Release cancelled / reset",
  VaultHashStored: "Vault hash stored",
  ContactRoleAccepted: "Contact accepted the role",
  ContactRoleDeclined: "Contact declined the role",
};

function describeLog(log: EventLog): string {
  const base = ACTION_LABELS[log.eventName] ?? log.eventName;
  if (log.eventName === "TrustedContactConfirmed") return `${base} (${log.args.count} of 2)`;
  if (log.eventName === "VaultCancelled") return `${base}: ${log.args.reason}`;
  return base;
}

interface EventsState {
  rows: LogRow[]; // newest first
  scanning: boolean;
  lastUpdated: number | null;
  error: string | null;
}

const EventsContext = createContext<EventsState>({ rows: [], scanning: true, lastUpdated: null, error: null });

export function EventsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EventsState>({ rows: [], scanning: true, lastUpdated: null, error: null });
  const scannedTo = useRef(DEPLOY_BLOCK - 1);
  const blockTimes = useRef(new Map<number, number>());
  const running = useRef(false);
  const rerun = useRef(false);

  useEffect(() => {
    // Add newly found rows (deduplicated, newest first).
    // Always merge, even after cleanup: scannedTo has already moved past these blocks,
    // so dropping them here would lose them for good (happens with React StrictMode remounts).
    const merge = (found: LogRow[], error: string | null) => {
      setState((prev) => {
        const seen = new Set(prev.rows.map((r) => r.id));
        const rows = [...found.filter((r) => !seen.has(r.id)), ...prev.rows].sort(
          (a, b) => b.block - a.block || b.logIndex - a.logIndex
        );
        return { rows, scanning: false, lastUpdated: error ? prev.lastUpdated : Date.now(), error };
      });
    };

    const scan = async (): Promise<void> => {
      // Never overlap scans; if one is running, run again right after it
      if (running.current) {
        rerun.current = true;
        return;
      }
      running.current = true;
      const found: LogRow[] = [];
      try {
        const latest = await readProvider.getBlockNumber();
        for (let from = scannedTo.current + 1; from <= latest; from += LOG_CHUNK_BLOCKS) {
          const to = Math.min(from + LOG_CHUNK_BLOCKS - 1, latest);
          const logs = (await readVault.queryFilter("*", from, to)).filter((l): l is EventLog => "eventName" in l);
          for (const log of logs) {
            if (!blockTimes.current.has(log.blockNumber)) {
              const b = await readProvider.getBlock(log.blockNumber);
              blockTimes.current.set(log.blockNumber, b?.timestamp ?? 0);
            }
            found.push({
              id: `${log.transactionHash}:${log.index}`,
              time: blockTimes.current.get(log.blockNumber)!,
              event: log.eventName,
              action: describeLog(log),
              txHash: log.transactionHash,
              block: log.blockNumber,
              logIndex: log.index,
              explorerUrl: txUrl(log.transactionHash),
            });
          }
          scannedTo.current = to; // only advance after the chunk succeeded
        }
        merge(found, null);
      } catch (e: any) {
        // Keep what earlier chunks found; the failed chunk is retried on the next scan
        merge(found, e?.shortMessage || e?.message || "Could not load events");
      } finally {
        running.current = false;
        if (rerun.current) {
          rerun.current = false;
          scan();
        }
      }
    };

    scan();
    const id = setInterval(scan, TXLOG_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return <EventsContext.Provider value={state}>{children}</EventsContext.Provider>;
}

export const useEvents = () => useContext(EventsContext);
