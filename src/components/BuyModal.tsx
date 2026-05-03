/**
 * BuyModal — confirms purchase and executes the on-chain transaction.
 *
 * Two flows:
 *
 * A) NFT pet (pet.mintAddress is set) — ATOMIC:
 *    1. POST /buy-prepare  → backend returns partially-signed tx (escrow signed NFT transfer)
 *    2. Phantom signTransaction → buyer adds SOL transfer signature
 *    3. Broadcast via connection.sendRawTransaction
 *    4. POST /buy-confirm → backend verifies + transfers DB ownership
 *
 * B) Non-NFT pet — LEGACY:
 *    1. Build SystemProgram.transfer tx
 *    2. sendTransaction via Phantom
 *    3. POST /buy → backend verifies SOL transfer + transfers DB ownership
 */

import React, { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Pet } from "../types";
import { buyPet, buyPrepare, buyConfirm } from "../services/api";
import { Modal } from "./Modals";
import { SpriteFrame } from "./SpriteFrame";
import { Icon, Spinner } from "./Icons";
import { cn } from "../lib/utils";

interface BuyModalProps {
  pet: Pet | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedPet: Pet) => void;
}

type Step = "confirm" | "wallet" | "verifying" | "done" | "error";

export function BuyModal({ pet, isOpen, onClose, onSuccess }: BuyModalProps) {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [step, setStep] = useState<Step>("confirm");
  const [errorMsg, setErrorMsg] = useState("");

  function handleClose() {
    setStep("confirm");
    setErrorMsg("");
    onClose();
  }

  // ── Flow A: atomic NFT buy ────────────────────────────────────────────────

  async function handleAtomicBuy() {
    if (!pet || !publicKey || !signTransaction) return;
    setStep("wallet");

    try {
      // Step 1: get partially-signed tx from backend
      const prepared = await buyPrepare(pet.id);

      // Step 2: deserialise the partially-signed transaction
      const txBytes = Buffer.from(prepared.tx, "base64");
      const tx = Transaction.from(txBytes);

      // Step 3: Phantom adds buyer's signature
      const signedTx = await signTransaction(tx);

      setStep("verifying");

      // Step 4: broadcast
      const rawTx = signedTx.serialize();
      const txSignature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      // Step 5: wait for confirmation
      await connection.confirmTransaction(txSignature, "confirmed");

      // Step 6: notify backend → update DB ownership
      const { pet: updatedPet } = await buyConfirm(pet.id, txSignature);

      setStep("done");
      setTimeout(() => {
        handleClose();
        onSuccess(updatedPet);
      }, 1200);
    } catch (err: any) {
      if (err.message?.includes("User rejected") || err.message?.includes("rejected")) {
        handleClose();
        return;
      }
      setErrorMsg(err.message ?? "Purchase failed");
      setStep("error");
    }
  }

  // ── Flow B: legacy SOL-only buy ───────────────────────────────────────────

  async function handleLegacyBuy() {
    if (!pet || !publicKey || !pet.priceLamports) return;
    setStep("wallet");

    try {
      const priceLamports = BigInt(pet.priceLamports);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(pet.ownerWallet),
          lamports: Number(priceLamports),
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const txSignature = await sendTransaction(tx, connection);

      setStep("verifying");
      await connection.confirmTransaction(txSignature, "confirmed");

      const { pet: updatedPet } = await buyPet(pet.id, txSignature);

      setStep("done");
      setTimeout(() => {
        handleClose();
        onSuccess(updatedPet);
      }, 1200);
    } catch (err: any) {
      if (err.message?.includes("User rejected")) {
        handleClose();
        return;
      }
      setErrorMsg(err.message ?? "Purchase failed");
      setStep("error");
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  function handleBuy() {
    if (!pet) return;
    if (pet.mintAddress) {
      handleAtomicBuy();
    } else {
      handleLegacyBuy();
    }
  }

  if (!pet) return null;

  const priceSol =
    pet.priceSol ?? (pet.priceLamports ? Number(pet.priceLamports) / LAMPORTS_PER_SOL : 0);
  const isNft = !!pet.mintAddress;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Buy Pet" width="480px">
      <div className="space-y-6">
        {/* Pet preview row */}
        <div className="flex items-center gap-4 bg-surface-warm p-4 rounded-xl border border-border">
          <SpriteFrame pet={pet} row={0} frames={6} size="thumb" />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg truncate">{pet.displayName}</h3>
            <p className="text-xs text-muted monoText">by {pet.ownerName}</p>
            {isNft && (
              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold uppercase tracking-widest text-accent monoText">
                <Icon name="sparkles" size={10} /> On-chain NFT
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold monoText">{priceSol.toFixed(3)}</p>
            <p className="text-xs text-muted font-medium">SOL</p>
          </div>
        </div>

        {/* What you get */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted monoText font-bold">What you get</p>
          <ul className="space-y-1.5 text-sm">
            {[
              isNft
                ? "NFT transferred to your wallet on Solana"
                : "Exclusive ownership on Solana",
              "pet.json — full metadata file",
              "spritesheet.webp — full sprite atlas",
              "Instant download after purchase",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2 text-muted">
                <Icon name="check" size={14} className="text-accent shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* NFT notice */}
        {isNft && step === "confirm" && (
          <div className="text-xs p-3 bg-surface-warm border border-border rounded-lg text-muted leading-relaxed">
            <strong className="text-foreground">Atomic transaction:</strong> SOL payment and NFT
            transfer happen in a single Solana transaction — both succeed or both fail.
          </div>
        )}

        {/* Status area */}
        {step === "wallet" && (
          <div className="flex items-center gap-3 p-4 bg-surface-warm rounded-xl border border-border text-sm">
            <Spinner />
            <span className="monoText">Waiting for Phantom approval…</span>
          </div>
        )}
        {step === "verifying" && (
          <div className="flex items-center gap-3 p-4 bg-surface-warm rounded-xl border border-border text-sm">
            <Spinner />
            <span className="monoText">Verifying on-chain…</span>
          </div>
        )}
        {step === "done" && (
          <div className="flex items-center gap-3 p-4 bg-accent-soft rounded-xl border border-accent/20 text-accent text-sm font-medium">
            <Icon name="check" size={18} />
            <span>{isNft ? "NFT transferred! Files unlocked." : "Purchase confirmed!"}</span>
          </div>
        )}
        {step === "error" && (
          <div className="p-4 bg-red-50 rounded-xl border border-red-200 text-red-600 text-sm">
            {errorMsg}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleClose}
            className="btn w-full"
            disabled={step === "wallet" || step === "verifying"}
          >
            Cancel
          </button>
          <button
            onClick={handleBuy}
            disabled={!publicKey || step !== "confirm"}
            className={cn(
              "btn btnPrimary w-full gap-2",
              (!publicKey || step !== "confirm") && "opacity-50 cursor-not-allowed"
            )}
          >
            {step === "confirm" ? (
              <>
                <Icon name="package" size={16} />
                Buy for {priceSol.toFixed(3)} SOL
              </>
            ) : (
              <Spinner />
            )}
          </button>
        </div>

        {!publicKey && (
          <p className="text-center text-xs text-muted">
            Connect your Phantom wallet to purchase.
          </p>
        )}
      </div>
    </Modal>
  );
}
