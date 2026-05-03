/**
 * Backend API client — all communication with the Express/Prisma backend.
 * Auth is handled via httpOnly cookie (set by the server on /api/auth/verify).
 * All requests include credentials: "include" so the browser sends the cookie automatically.
 */

import { Pet, PetEvent, UserProfile } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

// ── Base fetch wrapper ────────────────────────────────────────────────────────

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include", // sends httpOnly cookie automatically
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function requestNonce(wallet: string): Promise<{ nonce: string; message: string }> {
  return request("/api/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ wallet }),
  });
}

export async function verifySignature(
  wallet: string,
  signature: string,
  nonce: string
): Promise<{ user: { wallet: string; displayName: string | null } }> {
  // Server sets httpOnly cookie on success — no token in response body
  return request("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ wallet, signature, nonce }),
  });
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" }).catch(() => {});
}

export async function getMe(): Promise<UserProfile> {
  return request<UserProfile>("/api/auth/me");
}

export async function updateDisplayName(displayName: string): Promise<UserProfile> {
  return request<UserProfile>("/api/auth/me", {
    method: "PUT",
    body: JSON.stringify({ displayName }),
  });
}

// ── Pets ──────────────────────────────────────────────────────────────────────

export interface PetFilters {
  q?: string;
  tag?: string;
  sort?: "new" | "popular" | "listed";
  limit?: number;
  offset?: number;
}

export async function getPets(filters: PetFilters = {}): Promise<Pet[]> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));
  return request<Pet[]>(`/api/pets?${params}`);
}

export async function getPet(id: string): Promise<Pet> {
  return request<Pet>(`/api/pets/${id}`);
}

export async function toggleLike(petId: string): Promise<{ liked: boolean }> {
  return request<{ liked: boolean }>(`/api/pets/${petId}/like`, { method: "POST" });
}

/** DB-only listing for non-minted pets */
export async function listPetForSale(petId: string, priceSol: number): Promise<Pet> {
  return request<Pet>(`/api/pets/${petId}/list`, {
    method: "POST",
    body: JSON.stringify({ priceSol }),
  });
}

/**
 * NFT listing: the caller must have already transferred the NFT to the escrow
 * wallet on-chain via Phantom. This records the listing price.
 */
export async function listPetEscrow(petId: string, priceSol: number): Promise<Pet> {
  return request<Pet>(`/api/pets/${petId}/list-escrow`, {
    method: "POST",
    body: JSON.stringify({ priceSol }),
  });
}

export async function unlistPet(petId: string): Promise<Pet> {
  return request<Pet>(`/api/pets/${petId}/unlist`, { method: "POST" });
}

/** Legacy buy for non-minted pets (direct SOL transfer) */
export async function buyPet(
  petId: string,
  txSignature: string
): Promise<{ success: boolean; pet: Pet; message: string }> {
  return request(`/api/pets/${petId}/buy`, {
    method: "POST",
    body: JSON.stringify({ txSignature }),
  });
}

/** Step 1 of atomic NFT buy: ask backend to build partial-signed tx */
export async function buyPrepare(petId: string): Promise<{
  tx: string;
  blockhash: string;
  priceLamports: string;
  sellerWallet: string;
  escrowPublicKey: string;
}> {
  return request(`/api/pets/${petId}/buy-prepare`, { method: "POST" });
}

/** Step 2 of atomic NFT buy: confirm after buyer broadcasts */
export async function buyConfirm(
  petId: string,
  txSignature: string
): Promise<{ success: boolean; pet: Pet; message: string }> {
  return request(`/api/pets/${petId}/buy-confirm`, {
    method: "POST",
    body: JSON.stringify({ txSignature }),
  });
}

/** Record the on-chain mintAddress after user mints via Phantom */
export async function recordMintAddress(petId: string, mintAddress: string): Promise<Pet> {
  return request<Pet>(`/api/pets/${petId}/mint`, {
    method: "POST",
    body: JSON.stringify({ mintAddress }),
  });
}

/**
 * Pin the pet's spritesheet + metadata to IPFS via Pinata.
 * Returns the ipfs:// metadataUri to store on-chain and the HTTPS image URL.
 * Call this before minting.
 */
export async function pinNftMetadata(petId: string): Promise<{
  metadataUri: string;
  imageUri: string;
}> {
  return request(`/api/nft/pin/${petId}`, { method: "POST" });
}

/** Fetch escrow public key and network config from the backend */
export async function getNftConfig(): Promise<{
  escrowPublicKey: string;
  network: string;
}> {
  return request("/api/nft/config");
}

/** Returns the URL to trigger a gated ZIP download */
export async function downloadPetFiles(petId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pets/${petId}/download`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Download failed" }));
    throw new Error(body.error ?? "Download failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${petId}.codex-pet.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function deletePet(petId: string): Promise<void> {
  await request(`/api/pets/${petId}`, { method: "DELETE" });
}

/** Fetch the history events for a pet */
export async function getPetHistory(petId: string): Promise<PetEvent[]> {
  return request<PetEvent[]>(`/api/pets/${petId}/history`);
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadPet(
  petJsonFile: File,
  spritesheetFile: File,
  tags: string[] = []
): Promise<Pet> {
  const form = new FormData();
  form.append("petJson", petJsonFile);
  form.append("spritesheet", spritesheetFile);
  tags.forEach((t) => form.append("tags", t));

  const res = await fetch(`${API_BASE}/api/upload/pet`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(body.error ?? "Upload failed");
  }

  return res.json() as Promise<Pet>;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface UserPageData {
  wallet: string;
  displayName: string | null;
  createdAt: string;
  petCount: number;
  pets: Pet[];
}

export async function getUserPage(wallet: string): Promise<UserPageData> {
  return request<UserPageData>(`/api/users/${wallet}`);
}

export async function getMyPets(): Promise<Pet[]> {
  const me = await getMe();
  return request<Pet[]>(`/api/users/${me.wallet}/pets`);
}
