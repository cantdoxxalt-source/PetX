/**
 * Metaplex Core helpers for the backend.
 *
 * Responsibilities:
 *  - Load the escrow keypair from ESCROW_KEYPAIR env var
 *  - Provide a pre-configured UMI instance (escrow as identity/payer)
 *  - fetchOnChainOwner  — check who owns an NFT on-chain
 *  - buildAtomicBuyTx   — build an atomic SOL-transfer + NFT-transfer transaction
 *                         partially signed by the escrow; buyer must complete signing
 *  - escrowTransferNft  — backend-signed NFT transfer (used for unlist / refund)
 */

import {
  createUmi,
} from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplCore,
  transfer as mplCoreTransfer,
  fetchAsset,
} from "@metaplex-foundation/mpl-core";
import {
  keypairIdentity,
  publicKey as umiPk,
  createNoopSigner,
} from "@metaplex-foundation/umi";
import {
  toWeb3JsInstruction,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import { SOLANA_RPC } from "./solana";

// ── Escrow keypair ────────────────────────────────────────────────────────────

function loadEscrowKeypair(): Keypair {
  const raw = process.env.ESCROW_KEYPAIR;
  if (!raw) {
    console.warn("[metaplex] ESCROW_KEYPAIR not set — generating ephemeral keypair (not prod-safe)");
    return Keypair.generate();
  }
  try {
    const bytes = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    console.warn("[metaplex] ESCROW_KEYPAIR parse error — generating ephemeral keypair");
    return Keypair.generate();
  }
}

export const escrowKeypair = loadEscrowKeypair();
export const ESCROW_PUBLIC_KEY: string = escrowKeypair.publicKey.toString();

// ── UMI factory ───────────────────────────────────────────────────────────────

/** Creates a UMI instance with the escrow as identity/payer. */
export function buildUmi() {
  const umi = createUmi(SOLANA_RPC).use(mplCore());
  const umiEscrowKeypair = umi.eddsa.createKeypairFromSecretKey(escrowKeypair.secretKey);
  umi.use(keypairIdentity(umiEscrowKeypair));
  return umi;
}

// ── On-chain helpers ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the current on-chain owner of an MPL Core asset.
 * Retries up to `retries` times with `delayMs` between attempts to handle
 * RPC propagation lag after a freshly confirmed transaction.
 */
export async function fetchOnChainOwner(
  mintAddress: string,
  retries = 6,
  delayMs = 3000
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const umi = buildUmi();
      const asset = await fetchAsset(umi, umiPk(mintAddress));
      return asset.owner.toString();
    } catch (err: any) {
      const isLast = attempt === retries;
      console.log(`[metaplex] fetchOnChainOwner attempt ${attempt}/${retries} for ${mintAddress}: ${err?.message ?? err}`);
      if (isLast) return null;
      await sleep(delayMs);
    }
  }
  return null;
}

/**
 * Polls until the on-chain owner of `mintAddress` equals `expectedOwner`.
 *
 * Unlike fetchOnChainOwner, this retries on BOTH "asset not found" errors AND
 * "asset found but wrong owner" — handling the RPC propagation lag that occurs
 * after an ownership transfer (the account exists, but the RPC still returns
 * the old owner for a few seconds after confirmation).
 *
 * Returns the confirmed owner string, or null if retries exhausted.
 */
export async function waitForOwner(
  mintAddress: string,
  expectedOwner: string,
  retries = 10,
  delayMs = 3000
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const umi = buildUmi();
      const asset = await fetchAsset(umi, umiPk(mintAddress));
      const owner = asset.owner.toString();
      if (owner === expectedOwner) return owner;
      console.log(
        `[metaplex] waitForOwner attempt ${attempt}/${retries} for ${mintAddress}: ` +
        `got ${owner}, waiting for ${expectedOwner}`
      );
    } catch (err: any) {
      console.log(
        `[metaplex] waitForOwner attempt ${attempt}/${retries} for ${mintAddress}: ${err?.message ?? err}`
      );
    }
    if (attempt < retries) await sleep(delayMs);
  }
  console.log(`[metaplex] waitForOwner exhausted retries for ${mintAddress}`);
  return null;
}

/**
 * Returns true when `wallet` is the on-chain owner of `mintAddress`.
 */
export async function isOnChainOwner(mintAddress: string, wallet: string): Promise<boolean> {
  const owner = await fetchOnChainOwner(mintAddress);
  return owner !== null && owner === wallet;
}

// ── Atomic buy transaction ────────────────────────────────────────────────────

/**
 * System Program Transfer instruction encoding.
 * Instruction index 2 (Transfer) + u64 lamports, little-endian.
 */
function encodeSolTransfer(lamports: bigint): Uint8Array {
  const buf = new Uint8Array(12);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 2, true); // instruction index 2 = Transfer
  const low = Number(lamports & 0xffffffffn);
  const high = Number(lamports >> 32n);
  view.setUint32(4, low, true);
  view.setUint32(8, high, true);
  return buf;
}

export interface AtomicBuyResult {
  tx: string;     // base64-encoded partially-signed transaction
  blockhash: string;
}

/**
 * Build an atomic transaction that atomically:
 *   1. Transfers `priceLamports` SOL from buyer → seller
 *   2. Transfers the NFT from escrow → buyer
 *
 * The escrow partially signs for the NFT transfer.
 * The buyer must sign for the SOL transfer, then broadcast.
 *
 * Returns the base64-serialised partially-signed transaction.
 */
export async function buildAtomicBuyTx(
  mintAddress: string,
  buyerWallet: string,
  sellerWallet: string,
  priceLamports: bigint
): Promise<AtomicBuyResult> {
  const connection = new Connection(SOLANA_RPC, "confirmed");

  // ── Step 1: Build the UMI NFT transfer instruction ────────────────────────
  const umi = buildUmi(); // escrow is identity (authority for transfer)

  // fetchAsset to get the full AssetV1 object required by transfer()
  const asset = await fetchAsset(umi, umiPk(mintAddress));

  const nftTransferBuilder = mplCoreTransfer(umi, {
    asset,
    newOwner: umiPk(buyerWallet),
    // authority defaults to umi.identity = escrow ✓
  });

  // Extract raw UMI instructions → convert to web3.js TransactionInstruction
  const umiInstructions = nftTransferBuilder.items.map((item: any) => item.instruction);
  const nftTransferIxs = umiInstructions.map((ix: any) => toWeb3JsInstruction(ix));

  // ── Step 2: Build the web3.js transaction ────────────────────────────────
  const { blockhash } = await connection.getLatestBlockhash();

  // buyer is feePayer so Phantom shows the full SOL cost
  const tx = new Transaction({
    feePayer: new PublicKey(buyerWallet),
    recentBlockhash: blockhash,
  });

  // Instruction 1: buyer pays seller the listing price
  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(buyerWallet),
      toPubkey: new PublicKey(sellerWallet),
      lamports: Number(priceLamports),
    })
  );

  // Instruction 2+: MPL Core transfer (escrow → buyer)
  for (const ix of nftTransferIxs) {
    tx.add(ix);
  }

  // ── Step 3: Escrow partial-signs ─────────────────────────────────────────
  tx.partialSign(escrowKeypair);

  // ── Step 4: Serialize (buyer signature missing → requireAllSignatures=false)
  const serialized = tx.serialize({ requireAllSignatures: false });

  return {
    tx: Buffer.from(serialized).toString("base64"),
    blockhash,
  };
}

// ── Escrow-initiated transfer (unlist) ────────────────────────────────────────

/**
 * Transfer an NFT from the escrow back to `recipientWallet`.
 * Used when a seller unlists their pet.
 * The escrow is the sole signer (no buyer/seller involvement).
 */
export async function escrowTransferNft(
  mintAddress: string,
  recipientWallet: string
): Promise<string> {
  const umi = buildUmi();
  const asset = await fetchAsset(umi, umiPk(mintAddress));

  const { signature } = await mplCoreTransfer(umi, {
    asset,
    newOwner: umiPk(recipientWallet),
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  // signature is a Uint8Array in UMI; convert to base58 string
  const bs58 = await import("bs58");
  return bs58.default.encode(signature);
}
