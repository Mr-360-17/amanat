// Contract + network config. Everything comes from the files deploy.ts writes,
// so the pages work (read-only) even when the keeper API is offline.
import deployment from "../../deployment.json";
import abi from "../../abi/LegacyVault.json";

export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:4000";

export interface NetworkInfo {
  key: "local" | "mst";
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrl: string;
  currency: { name: string; symbol: string; decimals: number };
  explorer: string | null;
}

const NETWORKS: Record<string, NetworkInfo> = {
  mst: {
    key: "mst",
    chainId: 91562037,
    chainIdHex: "0x5752035",
    chainName: "MST Testnet",
    rpcUrl: "https://testnetrpc.mstblockchain.com",
    currency: { name: "tMSTC", symbol: "tMSTC", decimals: 18 },
    explorer: "https://testnet.mstscan.com",
  },
  local: {
    key: "local",
    chainId: 31337,
    chainIdHex: "0x7a69",
    chainName: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: null,
  },
};

export const NETWORK: NetworkInfo = NETWORKS[deployment.network] ?? NETWORKS.mst;
export const CONTRACT_ADDRESS: string = deployment.address;
export const DEPLOY_BLOCK: number = deployment.deployBlock;
export const ABI = abi;

export const txUrl = (hash: string) => (NETWORK.explorer ? `${NETWORK.explorer}/tx/${hash}` : null);
export const addressUrl = (addr: string) => (NETWORK.explorer ? `${NETWORK.explorer}/address/${addr}` : null);

// Polling intervals (ms) - gentle on the RPC
export const STATUS_POLL_MS = 4000;
export const AGENT_POLL_MS = 5000;
export const TXLOG_POLL_MS = 10000;
export const LOG_CHUNK_BLOCKS = 5000;
