/**
 * UMI (Metaplex) helpers for the frontend.
 *
 * Usage:
 *   const umi = getUmi(wallet);
 *   await create(umi, { asset: mint, name, uri }).sendAndConfirm(umi);
 */

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import type { WalletContextState } from "@solana/wallet-adapter-react";

const SOLANA_RPC =
  (import.meta as any).env?.VITE_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

/**
 * Creates a UMI instance with mplCore plugin and wallet adapter identity.
 * Call this inside a component where `useWallet()` is available.
 */
export function getUmi(wallet: WalletContextState) {
  return createUmi(SOLANA_RPC)
    .use(mplCore())
    .use(walletAdapterIdentity(wallet));
}
