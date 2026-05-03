export type PetTag = "cute" | "weird" | "minimal" | "animated" | "pixel" | "hand-drawn";

export interface ValidationReport {
  manifest: string;
  atlas: string;
  cell: string;
  states: number;
  petJsonSize: number;
  spritesheetSize: number;
}

export interface Pet {
  id: string;
  /** Current owner's wallet address */
  ownerWallet: string;
  /** Original creator's wallet address */
  creatorWallet: string;
  /** Human-readable owner name */
  ownerName: string;
  displayName: string;
  description: string;
  tags: PetTag[];
  frames: number;
  fps: number;
  scale: number;
  /** Public URL for the spritesheet (served by our backend, always accessible) */
  spritesheetUrl: string;
  /** Metaplex Core NFT mint address; null = not yet minted on-chain */
  mintAddress: string | null;
  /** Price in lamports (string to avoid JS BigInt issues), null = not listed */
  priceLamports: string | null;
  /** Price in SOL (convenience float), null = not listed */
  priceSol: number | null;
  isListed: boolean;
  likeCount: number;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
  likedByMe?: boolean;
  /** True when the current signed-in wallet is the owner */
  isOwner?: boolean;
  validationReport?: ValidationReport;
}

export type PetEventType = "CREATED" | "MINTED" | "LISTED" | "UNLISTED" | "SOLD";

export interface PetEvent {
  id: string;
  type: PetEventType;
  /** Primary actor: uploader, minter, seller, or buyer */
  walletAddress: string;
  /** Secondary actor: seller wallet for SOLD events */
  counterparty: string | null;
  /** Price in lamports (string), present for LISTED and SOLD */
  priceLamports: string | null;
  /** On-chain tx signature, present for SOLD events */
  txSignature: string | null;
  /** NFT mint address, present for MINTED events */
  mintAddress: string | null;
  createdAt: string;
}

export interface UserProfile {
  wallet: string;
  displayName: string | null;
  createdAt: string;
}

export interface AppState {
  user: UserProfile | null;
  route: { name: string; id?: string };
  pets: Pet[];
  loading: {
    gallery: boolean;
    auth: boolean;
  };
}

export const ANIMATION_STATES = [
  { id: "idle",          label: "Idle",        row: 0, frames: 6 },
  { id: "running-right", label: "Run right",   row: 1, frames: 8 },
  { id: "running-left",  label: "Run left",    row: 2, frames: 8 },
  { id: "waving",        label: "Waving",      row: 3, frames: 4 },
  { id: "jumping",       label: "Jumping",     row: 4, frames: 5 },
  { id: "failed",        label: "Failed",      row: 5, frames: 8 },
  { id: "waiting",       label: "Waiting",     row: 6, frames: 6 },
  { id: "running",       label: "Running",     row: 7, frames: 6 },
  { id: "review",        label: "Review",      row: 8, frames: 6 },
] as const;

export type AnimationStateId = (typeof ANIMATION_STATES)[number]["id"];
