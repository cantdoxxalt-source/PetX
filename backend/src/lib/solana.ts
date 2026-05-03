import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export const connection = new Connection(SOLANA_RPC, "confirmed");

// ── Wallet signature verification ────────────────────────────────────────────

/**
 * Verify that `wallet` signed `message` producing `signatureBase58`.
 * Phantom encodes the signature as base58 bytes of the raw ed25519 sig.
 */
export function verifyWalletSignature(
  wallet: string,
  message: string,
  signatureBase58: string
): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signatureBase58);
    const pubKeyBytes = new PublicKey(wallet).toBytes();
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
  } catch {
    return false;
  }
}

// ── Transaction verification ─────────────────────────────────────────────────

export interface TxVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Verify an on-chain SOL transfer:
 * - sender transferred exactly `expectedLamports` to `recipient`
 * - transaction is confirmed
 */
export async function verifySolTransfer(
  txSignature: string,
  expectedSender: string,
  expectedRecipient: string,
  expectedLamports: bigint
): Promise<TxVerifyResult> {
  try {
    const tx = await connection.getParsedTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) return { ok: false, error: "Transaction not found or not confirmed yet" };
    if (tx.meta?.err) return { ok: false, error: "Transaction failed on-chain" };

    // Walk through inner instructions looking for a SystemProgram transfer
    const instructions =
      tx.transaction.message.instructions as any[];

    for (const ix of instructions) {
      const prog = ix.programId?.toString();
      if (prog !== "11111111111111111111111111111111") continue; // SystemProgram
      const parsed = ix.parsed;
      if (!parsed || parsed.type !== "transfer") continue;

      const { source, destination, lamports } = parsed.info as {
        source: string;
        destination: string;
        lamports: number;
      };

      if (
        source === expectedSender &&
        destination === expectedRecipient &&
        BigInt(lamports) === expectedLamports
      ) {
        return { ok: true };
      }
    }

    return { ok: false, error: "No matching transfer instruction found in transaction" };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "RPC error" };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}
