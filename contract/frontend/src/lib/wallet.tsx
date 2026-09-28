// Wallet connection (MetaMask / BridgeKey) with automatic network add/switch.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ethers } from "ethers";
import { NETWORK } from "../config";

interface WalletState {
  hasWallet: boolean;
  account: string | null;
  wrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  getSigner: () => Promise<ethers.Signer>;
}

const WalletContext = createContext<WalletState | null>(null);

/** Ask the wallet to switch to our network, adding it first if the wallet doesn't know it. */
async function ensureNetwork() {
  const eth = window.ethereum!;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NETWORK.chainIdHex }] });
  } catch (e: any) {
    // 4902 = unknown chain (some wallets nest the code)
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e?.message || "")) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: NETWORK.chainIdHex,
          chainName: NETWORK.chainName,
          rpcUrls: [NETWORK.rpcUrl],
          nativeCurrency: NETWORK.currency,
          ...(NETWORK.explorer ? { blockExplorerUrls: [NETWORK.explorer] } : {}),
        },
      ],
    });
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  // Pick up an already-connected wallet silently + follow account/network changes
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAccounts = (accs: string[]) => setAccount(accs[0] ? ethers.getAddress(accs[0]) : null);
    const onChain = (id: string) => setChainId(parseInt(id, 16));
    eth.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
    eth.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet found. Install MetaMask or BridgeKey.");
      return;
    }
    try {
      const accs: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accs[0] ? ethers.getAddress(accs[0]) : null);
      await ensureNetwork();
      setChainId(parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16));
    } catch (e: any) {
      setError(e?.code === 4001 ? "Connection request was rejected." : e?.message || "Could not connect wallet.");
    }
  }, []);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or BridgeKey.");
    await ensureNetwork(); // always sign on the right chain
    return new ethers.BrowserProvider(window.ethereum).getSigner();
  }, []);

  const wrongNetwork = account !== null && chainId !== null && chainId !== NETWORK.chainId;

  return (
    <WalletContext.Provider value={{ hasWallet, account, wrongNetwork, error, connect, getSigner }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
