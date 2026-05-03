/**
 * WalletButton — custom wallet connect / sign-in flow.
 *
 * Key design: adapter.connect() is called DIRECTLY inside the onClick handler
 * (user gesture), not from a useEffect or autoConnect. This is the only reliable
 * way to get wallet extensions to show their popup immediately.
 *
 * Flow:
 *  1. "Connect Wallet" click → custom picker dropdown opens
 *  2. User clicks a wallet → adapter.connect() called in same click handler
 *  3. Wallet popup appears → user approves → WalletProvider context receives publicKey
 *  4. useEffect detects publicKey → sign-in nonce flow → JWT stored
 */

import React, { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { requestNonce, verifySignature, logout } from "../services/api";
import { UserProfile } from "../types";
import { Icon, Spinner } from "./Icons";
import { cn } from "../lib/utils";

interface WalletButtonProps {
  user: UserProfile | null;
  onLogin: (user: UserProfile) => void;
  onLogout: () => void;
  className?: string;
}

export function WalletButton({ user, onLogin, onLogout, className }: WalletButtonProps) {
  const wallet = useWallet();
  const { publicKey, signMessage, disconnect, connecting, wallets } = wallet;
  const [showPicker, setShowPicker] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showPicker]);

  // Sign in once publicKey appears (wallet just connected)
  useEffect(() => {
    if (!publicKey || user || signingIn) return;
    handleSignIn();
  }, [publicKey]);

  // ── Wallet picker click ──────────────────────────────────────────────────────
  async function handleWalletClick(w: (typeof wallets)[number]) {
    setShowPicker(false);
    setError(null);

    try {
      // 1. Register in context so signMessage / sendTransaction work later
      wallet.select(w.adapter.name);

      // 2. Connect directly from the click handler (user gesture → popup appears)
      await w.adapter.connect();

      // WalletProvider listens to adapter events and will set publicKey in context,
      // which triggers the sign-in useEffect above.
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (!msg.includes("User rejected") && !msg.includes("rejected")) {
        setError(msg || "Connection failed");
      }
    }
  }

  // ── Sign in ──────────────────────────────────────────────────────────────────
  async function handleSignIn() {
    if (!publicKey || !signMessage) return;
    setSigningIn(true);
    setError(null);
    try {
      const addr = publicKey.toBase58();
      const { nonce, message } = await requestNonce(addr);
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await signMessage(msgBytes);
      const signature = bs58.encode(sigBytes);
      const { user: backendUser } = await verifySignature(addr, signature, nonce);
      // Server set httpOnly cookie — no token to store client-side
      onLogin({
        wallet: backendUser.wallet,
        displayName: backendUser.displayName,
        createdAt: new Date().toISOString(),
      });
    } catch (err: any) {
      setError(err.message ?? "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  }

  // ── Logout ───────────────────────────────────────────────────────────────────
  async function handleLogout() {
    await logout();                     // clears httpOnly cookie on server
    await disconnect().catch(() => {}); // clears publicKey first
    wallet.select(null as any);         // deselect so adapter is clean
    onLogout();                         // publicKey already null → sign-in effect won't fire
  }

  // ── Render: logged in ────────────────────────────────────────────────────────
  if (user) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 pl-4 border-l border-border hover:opacity-80 transition-opacity"
        >
          <div className="w-7 h-7 rounded-full bg-surface-soft flex items-center justify-center text-muted border border-border-strong">
            <Icon name="user" size={14} />
          </div>
          <span className="text-sm font-medium monoText hidden sm:block">
            {user.displayName ?? user.wallet.slice(0, 6) + "…"}
          </span>
        </button>
      </div>
    );
  }

  // ── Render: busy ─────────────────────────────────────────────────────────────
  if (signingIn || connecting) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted", className)}>
        <Spinner />
        <span className="monoText">{connecting ? "Connecting…" : "Signing in…"}</span>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-xs text-red-500 max-w-[160px] truncate">{error}</span>
        <button onClick={() => setError(null)} className="btn btnSm">Retry</button>
      </div>
    );
  }

  // ── Render: connect button + picker ──────────────────────────────────────────
  return (
    <div ref={pickerRef} className={cn("relative", className)}>
      <button
        onClick={() => setShowPicker((v) => !v)}
        className="btn btnPrimary h-9 px-4 text-sm font-medium gap-2"
      >
        <Icon name="user" size={14} /> Connect Wallet
      </button>

      {showPicker && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-border rounded-xl shadow-xl z-50 p-2 overflow-hidden">
          <p className="text-[10px] text-muted monoText uppercase tracking-widest px-3 py-1.5">
            Select Wallet
          </p>

          {wallets.length === 0 ? (
            <p className="text-xs text-muted px-3 py-3">
              No wallets detected.{" "}
              <a
                href="https://phantom.app"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                Install Phantom
              </a>
            </p>
          ) : (
            wallets.map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => handleWalletClick(w)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-warm transition-colors text-left"
              >
                {w.adapter.icon ? (
                  <img src={w.adapter.icon} alt="" className="w-6 h-6 rounded-md shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-md bg-surface-warm border border-border shrink-0" />
                )}
                <span className="text-sm font-medium flex-1">{w.adapter.name}</span>
                {w.readyState === "Installed" && (
                  <span className="text-[10px] monoText text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                    Ready
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
