import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import Protection from "./pages/Protection";
import TrustedContact from "./pages/TrustedContact";
import TxLog from "./pages/TxLog";
import { Address, Toasts, networkLabel } from "./components";
import { CONTRACT_ADDRESS } from "./config";
import { EventsProvider } from "./lib/events";
import { WalletProvider, useWallet } from "./lib/wallet";

function WalletButton() {
  const { hasWallet, account, wrongNetwork, error, connect } = useWallet();
  return (
    <div className="wallet">
      {account ? (
        <>
          {wrongNetwork && (
            <button className="btn btn-small btn-warn" onClick={connect}>
              Switch network
            </button>
          )}
          <span className="wallet-addr">
            <Address addr={account} />
          </span>
        </>
      ) : (
        <button className="btn btn-small btn-light" onClick={connect}>
          {hasWallet ? "Connect wallet" : "No wallet found"}
        </button>
      )}
      {error && <div className="wallet-error">{error}</div>}
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <EventsProvider>
        <BrowserRouter>
          <header className="topbar">
            <div className="brand">
              <span className="logo">◆</span> LegacyVault
            </div>
            <nav>
              <NavLink to="/protection">Protection</NavLink>
              <NavLink to="/trusted-contact">Trusted contact</NavLink>
              <NavLink to="/txlog">Transaction log</NavLink>
            </nav>
            <span className="network">{networkLabel}</span>
            <WalletButton />
          </header>

          <main>
            <Routes>
              <Route path="/" element={<Navigate to="/protection" replace />} />
              <Route path="/protection" element={<Protection />} />
              <Route path="/trusted-contact" element={<TrustedContact />} />
              <Route path="/txlog" element={<TxLog />} />
              <Route path="*" element={<Navigate to="/protection" replace />} />
            </Routes>
          </main>

          <footer>
            Prototype. Does not hold or transfer funds. Only hashes and state are stored on-chain.
            <div className="muted">
              Contract <Address addr={CONTRACT_ADDRESS} /> · {networkLabel}
            </div>
          </footer>
          <Toasts />
        </BrowserRouter>
      </EventsProvider>
    </WalletProvider>
  );
}
