import React, { useState, useEffect, useCallback } from "react";

// Cluster for Solana Explorer links ("mainnet-beta" has no cluster param)
const SOLANA_CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER ?? "mainnet-beta";
const explorerUrl = (address: string) =>
  SOLANA_CLUSTER === "mainnet-beta"
    ? `https://explorer.solana.com/address/${address}`
    : `https://explorer.solana.com/address/${address}?cluster=${SOLANA_CLUSTER}`;
import { Pet, PetEvent, AppState, UserProfile, ANIMATION_STATES, PetTag } from "./types";
import * as api from "./services/api";
import { Icon, Spinner } from "./components/Icons";
import { SpriteFrame, PetStats } from "./components/SpriteFrame";
import { TagPills, PetCard } from "./components/PetCard";
import { Modal } from "./components/Modals";
import { WalletButton } from "./components/WalletButton";
import { BuyModal } from "./components/BuyModal";
import { cn, formatDate, formatCompactNumber } from "./lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { downloadPetFiles } from "./services/api";
import { useWallet } from "@solana/wallet-adapter-react";
import { getUmi } from "./lib/umi";
import { create, transfer as mplTransfer, fetchAsset } from "@metaplex-foundation/mpl-core";
import { generateSigner, publicKey as umiPk } from "@metaplex-foundation/umi";

// ── Hash router ───────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "mine") return { name: "mine" };
  if (hash === "favorites") return { name: "favorites" };
  if (hash === "upload") return { name: "upload" };
  if (hash.startsWith("pets/")) return { name: "detail", id: hash.split("/")[1] };
  if (hash.startsWith("users/")) return { name: "user", id: hash.split("/")[1] };
  return { name: "gallery" };
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>({
    user: null,
    route: parseRoute(),
    pets: [],
    loading: { gallery: true, auth: true },
  });
  const [activePet, setActivePet] = useState<Pet | null>(null);
  const [activePetLoading, setActivePetLoading] = useState(false);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [sharePet, setSharePet] = useState<Pet | null>(null);
  const [buyPet, setBuyPet] = useState<Pet | null>(null);
  const [filters, setFilters] = useState({ q: "", tag: "", sort: "new" as const });

  // ── Restore session from httpOnly cookie ──────────────────────────────────
  useEffect(() => {
    api.getMe()
      .then((u) => setState((prev) => ({ ...prev, user: u, loading: { ...prev.loading, auth: false } })))
      .catch(() => {
        // Not logged in — cookie absent or expired
        setState((prev) => ({ ...prev, loading: { ...prev.loading, auth: false } }));
      });
  }, []);

  // ── Route listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => setState((prev) => ({ ...prev, route: parseRoute() }));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ── Gallery fetch ───────────────────────────────────────────────────────────
  const fetchGallery = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: { ...prev.loading, gallery: true } }));
    try {
      const pets = await api.getPets(filters);
      setState((prev) => ({ ...prev, pets, loading: { ...prev.loading, gallery: false } }));
    } catch {
      setState((prev) => ({ ...prev, pets: [], loading: { ...prev.loading, gallery: false } }));
    }
  }, [filters]);

  useEffect(() => {
    if (state.route.name === "gallery") fetchGallery();
  }, [state.route.name, filters.sort, filters.tag, filters.q]);

  // ── Pet detail fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.route.name === "detail" && state.route.id) {
      if (activePet?.id === state.route.id) return;
      (async () => {
        setActivePetLoading(true);
        try {
          const pet = await api.getPet(state.route.id!);
          setActivePet(pet);
        } catch {
          setActivePet(null);
        } finally {
          setActivePetLoading(false);
        }
      })();
    }
  }, [state.route.name, state.route.id]);

  const navigate = (hash: string) => { window.location.hash = hash; };

  // ── Like ────────────────────────────────────────────────────────────────────
  const handleLike = async (pet: Pet) => {
    if (!state.user) { navigate("#/upload"); return; } // prompt sign-in
    setLikeBusyId(pet.id);
    try {
      const { liked } = await api.toggleLike(pet.id);
      const update = (list: Pet[]) =>
        list.map((p) =>
          p.id === pet.id
            ? { ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) }
            : p
        );
      setState((prev) => ({ ...prev, pets: update(prev.pets) }));
      if (activePet?.id === pet.id) setActivePet((p) => p && { ...p, likedByMe: liked, likeCount: p.likeCount + (liked ? 1 : -1) });
    } finally {
      setLikeBusyId(null);
    }
  };

  // ── Auth callbacks ──────────────────────────────────────────────────────────
  const handleLogin = (user: UserProfile) => {
    setState((prev) => ({ ...prev, user, loading: { ...prev.loading, auth: false } }));
  };
  const handleLogout = () => {
    setState((prev) => ({ ...prev, user: null }));
    if (["mine", "favorites"].includes(state.route.name)) navigate("#/");
  };

  // ── Buy success ─────────────────────────────────────────────────────────────
  const handleBuySuccess = (updatedPet: Pet) => {
    setActivePet(updatedPet);
    setState((prev) => ({
      ...prev,
      pets: prev.pets.map((p) => (p.id === updatedPet.id ? updatedPet : p)),
    }));
  };

  return (
    <div className="min-h-screen flex flex-col pt-4">
      <NavBar
        user={state.user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onNavigate={navigate}
        currentRoute={state.route.name}
      />

      <main className="flex-1 w-[min(1080px,calc(100vw-64px))] mx-auto pb-24 z-10">
        <AnimatePresence mode="wait">
          {state.route.name === "gallery" && (
            <GalleryPage
              state={state}
              filters={filters}
              setFilters={setFilters}
              navigate={navigate}
              handleLike={handleLike}
              likeBusyId={likeBusyId}
              onShare={setSharePet}
              onBuy={setBuyPet}
            />
          )}
          {state.route.name === "detail" && (
            <DetailPage
              pet={activePet}
              loading={activePetLoading}
              handleLike={handleLike}
              likeBusyId={likeBusyId}
              user={state.user}
              onDelete={async (id) => {
                if (!window.confirm("Delete this pet?")) return;
                await api.deletePet(id);
                setState((prev) => ({ ...prev, pets: prev.pets.filter((p) => p.id !== id) }));
                navigate("#/");
              }}
              onShare={setSharePet}
              onBuy={setBuyPet}
            />
          )}
          {state.route.name === "upload" && (
            <UploadPage
              user={state.user}
              onSuccess={(pet) => {
                setActivePet(pet);
                setState((prev) => ({ ...prev, pets: [pet, ...prev.pets] }));
                navigate(`#/pets/${pet.id}`);
              }}
            />
          )}
          {state.route.name === "favorites" && (
            <FavoritesPage
              user={state.user}
              navigate={navigate}
              handleLike={handleLike}
              likeBusyId={likeBusyId}
              onShare={setSharePet}
              onBuy={setBuyPet}
            />
          )}
          {state.route.name === "mine" && (
            <MyUploadsPage user={state.user} navigate={navigate} />
          )}
          {state.route.name === "user" && (
            <UserPage
              userId={state.route.id!}
              currentUser={state.user}
              navigate={navigate}
              handleLike={handleLike}
              likeBusyId={likeBusyId}
              onShare={setSharePet}
              onBuy={setBuyPet}
              onUpdateUser={(u) => setState(prev => ({ ...prev, user: u }))}
              onLogout={handleLogout}
            />
          )}
        </AnimatePresence>
      </main>

      <ShareModal pet={sharePet} isOpen={!!sharePet} onClose={() => setSharePet(null)} />

      <BuyModal
        pet={buyPet}
        isOpen={!!buyPet}
        onClose={() => setBuyPet(null)}
        onSuccess={handleBuySuccess}
      />
    </div>
  );
}

// ── NavBar ────────────────────────────────────────────────────────────────────

function NavBar({
  user,
  onLogin,
  onLogout,
  onNavigate,
  currentRoute,
}: {
  user: UserProfile | null;
  onLogin: (u: UserProfile) => void;
  onLogout: () => void;
  onNavigate: (h: string) => void;
  currentRoute: string;
}) {
  const { disconnect, select } = useWallet();

  async function handleLogout() {
    await api.logout();                 // clears httpOnly cookie on server
    await disconnect().catch(() => {});
    select(null as any);
    onLogout();
  }

  return (
    <nav className="sticky top-0 z-40 bg-bg/85 backdrop-blur-md border-b border-border-soft mb-8">
      <div className="w-[min(1080px,calc(100vw-64px))] mx-auto h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <button onClick={() => onNavigate("#/")} className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded bg-ink flex items-center justify-center text-white group-hover:scale-105 transition-transform">
              <Icon name="package" size={18} />
            </div>
            <span className="font-bold tracking-tight text-xl">PetX</span>
          </button>
          <div className="hidden md:flex items-center gap-6">
            <button onClick={() => onNavigate("#/")} className={cn("text-sm font-medium transition-colors", currentRoute === "gallery" ? "text-foreground" : "text-muted hover:text-foreground")}>Marketplace</button>
            <button onClick={() => onNavigate("#/upload")} className={cn("text-sm font-medium transition-colors", currentRoute === "upload" ? "text-foreground" : "text-muted hover:text-foreground")}>Upload</button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-6">
              <button onClick={() => onNavigate("#/favorites")} className={cn("text-sm font-medium transition-colors hidden md:block", currentRoute === "favorites" ? "text-foreground" : "text-muted hover:text-foreground")}>Favorites</button>
              <button onClick={() => onNavigate("#/mine")} className={cn("text-sm font-medium transition-colors hidden md:block", currentRoute === "mine" ? "text-foreground" : "text-muted hover:text-foreground")}>My Pets</button>
              {/* Avatar → profile page; separate sign-out icon */}
              <div className="flex items-center gap-1 pl-4 border-l border-border">
                <button
                  onClick={() => onNavigate(`#/users/${user.wallet}`)}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  title="View profile"
                >
                  <div className="w-7 h-7 rounded-full bg-surface-soft flex items-center justify-center text-muted border border-border-strong">
                    <Icon name="user" size={14} />
                  </div>
                  <span className="text-sm font-medium monoText hidden sm:block truncate max-w-[120px]">
                    {user.displayName ?? user.wallet.slice(0, 8) + "…"}
                  </span>
                </button>
                <button
                  onClick={handleLogout}
                  className="ml-1 p-1.5 rounded-md text-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Disconnect wallet"
                >
                  <Icon name="logout" size={15} />
                </button>
              </div>
            </div>
          ) : (
            <WalletButton user={user} onLogin={onLogin} onLogout={onLogout} />
          )}
        </div>
      </div>
    </nav>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────────

function GalleryPage({
  state,
  filters,
  setFilters,
  navigate,
  handleLike,
  likeBusyId,
  onShare,
  onBuy,
}: {
  state: AppState;
  filters: any;
  setFilters: any;
  navigate: any;
  handleLike: any;
  likeBusyId: string | null;
  onShare: (p: Pet) => void;
  onBuy: (p: Pet) => void;
}) {
  const [searchVal, setSearchVal] = useState(filters.q);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="mb-12">
        <h1 className="text-[clamp(40px,5vw,64px)] font-medium tracking-tighter leading-none mb-2">PetX</h1>
        <p className="text-muted text-lg max-w-2xl">Discover, collect and trade companion pets for your terminal. Powered by Solana.</p>
      </section>

      <div className="space-y-6 mb-8 pb-8 border-b border-border-soft">
        <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); setFilters((f: any) => ({ ...f, q: searchVal })); }}>
          <div className="relative flex-1">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted"><Icon name="search" size={20} /></div>
            <input type="text" placeholder="Search pets…" className="w-full h-12 pl-12 pr-4 bg-surface border border-border rounded-lg text-lg focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} />
          </div>
          <button type="submit" className="btn btnLg btnPrimary min-w-[120px]">Find</button>
        </form>

        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex bg-surface-soft p-1 rounded-md border border-border-soft">
            {["new", "popular", "listed"].map((s) => (
              <button key={s} onClick={() => setFilters((f: any) => ({ ...f, sort: s }))} className={cn("px-4 h-7 rounded-[4px] text-[11px] uppercase tracking-wider font-semibold transition-all", filters.sort === s ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground")}>{s}</button>
            ))}
          </div>
          <TagPills variant="filter" tags={[]} activeTags={filters.tag ? [filters.tag] : []} onToggle={(t) => setFilters((f: any) => ({ ...f, tag: t }))} />
        </div>
      </div>

      {state.loading.gallery ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => <PetCardSkeleton key={i} index={i} />)}
        </div>
      ) : state.pets.length === 0 ? (
        <div className="py-24 text-center bg-surface-warm/30 rounded-xl border border-dashed border-border flex flex-col items-center">
          <Icon name="search" size={32} className="text-muted mb-4" />
          <h3 className="text-xl font-medium mb-1">No pets found</h3>
          <p className="text-muted">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {state.pets.map((pet, i) => (
            <div key={pet.id} className="revealItem" style={{ "--delay": `${i * 60}ms` } as any}>
              <PetCard
                pet={pet}
                onClick={() => navigate(`#/pets/${pet.id}`)}
                onLike={() => handleLike(pet)}
                onShare={() => onShare(pet)}
                onBuy={pet.isListed ? () => onBuy(pet) : undefined}
                isLikeBusy={likeBusyId === pet.id}
              />
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

// ── HistoryCard ───────────────────────────────────────────────────────────────

const CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER ?? "mainnet-beta";

function txUrl(sig: string) {
  return CLUSTER === "mainnet-beta"
    ? `https://explorer.solana.com/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

function shortAddr(addr: string) {
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function solFromLamports(lamports: string) {
  return (Number(BigInt(lamports)) / 1_000_000_000).toFixed(3);
}

const EVENT_META: Record<string, { icon: string; label: string; color: string }> = {
  CREATED:  { icon: "🎨", label: "Created",  color: "text-blue-600"   },
  MINTED:   { icon: "✨", label: "Minted",   color: "text-purple-600" },
  LISTED:   { icon: "⬆",  label: "Listed",   color: "text-amber-600"  },
  UNLISTED: { icon: "↩",  label: "Unlisted", color: "text-gray-500"   },
  SOLD:     { icon: "◎",  label: "Sold",     color: "text-green-600"  },
};

function HistoryCard({ petId }: { petId: string }) {
  const [events, setEvents] = useState<PetEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getPetHistory(petId)
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [petId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-6">
        <Spinner /> Loading history…
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted py-4 text-center">No history events yet.</p>
    );
  }

  return (
    <div className="relative">
      {/* vertical timeline line */}
      <div className="absolute left-[18px] top-2 bottom-2 w-px bg-border-soft" />
      <ul className="space-y-4">
        {events.map((ev) => {
          const meta = EVENT_META[ev.type] ?? { icon: "•", label: ev.type, color: "text-foreground" };
          return (
            <li key={ev.id} className="flex gap-4 items-start relative">
              {/* dot */}
              <div className={cn(
                "w-9 h-9 rounded-full border-2 border-border bg-surface flex items-center justify-center text-sm shrink-0 z-10",
                ev.type === "SOLD" && "bg-green-50 border-green-200",
                ev.type === "MINTED" && "bg-purple-50 border-purple-200",
                ev.type === "LISTED" && "bg-amber-50 border-amber-200",
              )}>
                {meta.icon}
              </div>
              {/* content */}
              <div className="flex-1 pt-1 pb-3 border-b border-border-soft last:border-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={cn("text-xs font-bold monoText uppercase tracking-wide", meta.color)}>
                    {meta.label}
                  </span>
                  {ev.priceLamports && (
                    <span className="text-xs monoText text-foreground font-semibold">
                      {solFromLamports(ev.priceLamports)} SOL
                    </span>
                  )}
                  <span className="text-[11px] text-muted monoText ml-auto">
                    {new Date(ev.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {/* actor line */}
                <p className="text-xs text-muted mt-0.5">
                  {ev.type === "SOLD" ? (
                    <>
                      Bought by{" "}
                      <a href={explorerUrl(ev.walletAddress)} target="_blank" rel="noreferrer" className="hover:text-accent underline">{shortAddr(ev.walletAddress)}</a>
                      {" "}from{" "}
                      <a href={explorerUrl(ev.counterparty!)} target="_blank" rel="noreferrer" className="hover:text-accent underline">{shortAddr(ev.counterparty!)}</a>
                    </>
                  ) : (
                    <>
                      By{" "}
                      <a href={explorerUrl(ev.walletAddress)} target="_blank" rel="noreferrer" className="hover:text-accent underline">{shortAddr(ev.walletAddress)}</a>
                    </>
                  )}
                </p>
                {/* links */}
                <div className="flex gap-3 mt-1.5 flex-wrap">
                  {ev.txSignature && (
                    <a
                      href={txUrl(ev.txSignature)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] monoText text-muted hover:text-accent underline underline-offset-2"
                    >
                      <span>Tx</span>
                      <span>{ev.txSignature.slice(0, 8)}…</span>
                    </a>
                  )}
                  {ev.mintAddress && (
                    <a
                      href={explorerUrl(ev.mintAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] monoText text-muted hover:text-accent underline underline-offset-2"
                    >
                      <span>Mint</span>
                      <span>{ev.mintAddress.slice(0, 8)}…</span>
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DetailPage({
  pet,
  loading,
  handleLike,
  likeBusyId,
  user,
  onDelete,
  onShare,
  onBuy,
}: {
  pet: Pet | null;
  loading: boolean;
  handleLike: any;
  likeBusyId: string | null;
  user: UserProfile | null;
  onDelete: (id: string) => void;
  onShare: (p: Pet) => void;
  onBuy: (p: Pet) => void;
}) {
  const wallet = useWallet();
  const [activeState, setActiveState] = useState<typeof ANIMATION_STATES[number]>(ANIMATION_STATES[0]);
  const [showListModal, setShowListModal] = useState(false);
  const [priceSolInput, setPriceSolInput] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [mintBusy, setMintBusy] = useState(false);
  const [mintStep, setMintStep] = useState<"ipfs" | "wallet" | "recording" | "">("");
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintSuccess, setMintSuccess] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [localPet, setLocalPet] = useState<Pet | null>(null);

  useEffect(() => { setLocalPet(pet); }, [pet]);

  if (loading) return <DetailSkeleton />;
  if (!localPet) return (
    <div className="max-w-4xl mx-auto px-6 py-20 text-center">
      <h2 className="text-2xl font-serif mb-4">Pet not found</h2>
      <p className="text-muted mb-8">The link may be broken or the pet was removed.</p>
      <button onClick={() => window.location.hash = "#/"} className="btn btnPrimary">Back to Marketplace</button>
    </div>
  );

  const isOwner = user?.wallet === localPet.ownerWallet;
  const isMinted = !!localPet.mintAddress;

  // ── Mint as NFT ────────────────────────────────────────────────────────────
  async function handleMint() {
    if (!wallet.publicKey || !wallet.connected) return;
    setMintBusy(true);
    setMintError(null);
    setMintStep("");
    try {
      // Step 1: pin image + metadata to IPFS
      setMintStep("ipfs");
      const { metadataUri } = await api.pinNftMetadata(localPet!.id);

      // Step 2: create the NFT on-chain via Phantom
      setMintStep("wallet");
      const umi = getUmi(wallet);
      const mint = generateSigner(umi);

      await create(umi, {
        asset: mint,
        name: localPet!.displayName,
        uri: metadataUri, // ipfs:// URI — permanent, decentralized
      }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

      // Step 3: record mint address in backend DB
      setMintStep("recording");
      // Give the RPC a moment to propagate the new account
      await new Promise((r) => setTimeout(r, 4000));
      const updated = await api.recordMintAddress(localPet!.id, mint.publicKey);
      setLocalPet(updated);
      setMintSuccess(true);
      setTimeout(() => setMintSuccess(false), 4000);
    } catch (err: any) {
      if (err.message?.includes("User rejected") || err.message?.includes("rejected")) {
        // silently ignore phantom rejection
      } else {
        setMintError(err.message ?? "Minting failed");
      }
    } finally {
      setMintBusy(false);
      setMintStep("");
    }
  }

  // ── List for sale ──────────────────────────────────────────────────────────
  async function handleList() {
    const price = parseFloat(priceSolInput);
    if (!price || price <= 0) return;
    setListBusy(true);
    setListError(null);
    try {
      if (isMinted) {
        // NFT flow: transfer to escrow first via Phantom, then call list-escrow
        const config = await api.getNftConfig();
        const umi = getUmi(wallet);
        // fetchAsset required by mplTransfer (needs full AssetV1 object)
        const asset = await fetchAsset(umi, umiPk(localPet!.mintAddress!));
        await mplTransfer(umi, {
          asset,
          newOwner: umiPk(config.escrowPublicKey),
        }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
        // Wait for Helius RPC to propagate the transfer before the backend checks it
        await new Promise((r) => setTimeout(r, 4000));
        const updated = await api.listPetEscrow(localPet!.id, price);
        setLocalPet(updated);
      } else {
        // Legacy flow: DB-only listing
        const updated = await api.listPetForSale(localPet!.id, price);
        setLocalPet(updated);
      }
      setShowListModal(false);
    } catch (err: any) {
      if (err.message?.includes("User rejected") || err.message?.includes("rejected")) {
        // Phantom rejected — user cancelled, just stay on modal
      } else {
        setListError(err.message ?? "Listing failed");
      }
    } finally {
      setListBusy(false);
    }
  }

  async function handleUnlist() {
    setListBusy(true);
    try {
      const updated = await api.unlistPet(localPet!.id);
      setLocalPet(updated);
    } finally {
      setListBusy(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,600px] gap-12 items-start">
        {/* Left: Preview */}
        <div className="space-y-4">
          <div className="aspect-square lg:aspect-auto bg-white border border-border rounded-2xl p-8 flex items-center justify-center min-h-[400px]">
            <SpriteFrame pet={localPet} row={activeState.row} frames={activeState.frames} size="large" />
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Owner: download package + raw sheet */}
            {isOwner ? (
              <>
                <button onClick={() => downloadPetFiles(localPet.id)} className="btn btnLg btnPrimary w-full col-span-2 gap-2">
                  <Icon name="package" /> Download Files
                </button>
                <button onClick={() => window.open(localPet.spritesheetUrl, "_blank")} className="btn btnLg w-full col-span-2 gap-2">
                  <Icon name="sheet" /> View Sheet
                </button>
              </>
            ) : localPet.isListed ? (
              /* Not owner + listed → show buy button spanning full width */
              <button onClick={() => onBuy(localPet)} className="btn btnLg btnPrimary w-full col-span-4 gap-2">
                <Icon name="package" /> Buy · {localPet.priceSol?.toFixed(3)} SOL
              </button>
            ) : (
              /* Not owner + not listed → locked hint */
              <div className="col-span-4 flex items-center gap-2 px-4 h-11 rounded-lg border border-dashed border-border text-muted text-sm">
                <Icon name="package" size={16} />
                <span>Files unlocked for owner only</span>
              </div>
            )}
            <button
              onClick={() => handleLike(localPet)}
              className={cn("btn btnLg w-full", localPet.likedByMe && "bg-accent-soft border-accent/20 text-accent-deep")}
            >
              {likeBusyId === localPet.id ? <Spinner /> : <Icon name="heart" className={localPet.likedByMe ? "fill-current" : ""} />}
              {localPet.likedByMe ? "Liked" : "Like"}
            </button>
            <button onClick={() => onShare(localPet)} className="btn btnLg w-full"><Icon name="share" /> Share</button>
          </div>

          {/* Owner controls */}
          {isOwner && (
            <div className="space-y-3">
              {/* Mint as NFT (only if not yet minted) */}
              {!isMinted && (
                <div className="flex gap-3">
                  <button
                    onClick={handleMint}
                    disabled={mintBusy || !wallet.connected}
                    className="btn btnLg w-full gap-2 border-accent/40 text-accent hover:bg-accent-soft"
                  >
                    {mintBusy ? (
                      <>
                        <Spinner />
                        {mintStep === "ipfs"      && "Uploading to IPFS…"}
                        {mintStep === "wallet"    && "Confirm in Phantom…"}
                        {mintStep === "recording" && "Confirming on-chain…"}
                        {!mintStep                && "Please wait…"}
                      </>
                    ) : (
                      <><Icon name="sparkles" /> Mint as NFT</>
                    )}
                  </button>
                </div>
              )}
              {mintSuccess && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs monoText">
                  <Icon name="check" size={14} className="shrink-0" /> NFT minted on Solana mainnet!
                </div>
              )}
              {mintError && (
                <p className="text-xs text-red-500 monoText">{mintError}</p>
              )}

              {/* NFT status badge */}
              {isMinted && (
                <div className="flex items-center gap-2 px-3 py-2 bg-accent-soft/20 border border-accent/20 rounded-lg">
                  <Icon name="sparkles" size={14} className="text-accent shrink-0" />
                  <span className="text-xs monoText text-accent font-semibold">On-chain NFT</span>
                  <a
                    href={explorerUrl(localPet.mintAddress!)}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-[10px] text-muted hover:text-accent monoText underline"
                  >
                    {localPet.mintAddress?.slice(0, 8)}…
                  </a>
                </div>
              )}

              {/* List / unlist */}
              <div className="flex gap-3">
                {localPet.isListed ? (
                  <button onClick={handleUnlist} disabled={listBusy} className="btn btnLg w-full gap-2">
                    {listBusy ? <Spinner /> : <><Icon name="check" /> Unlist</>}
                  </button>
                ) : (
                  <button onClick={() => { setShowListModal(true); setListError(null); }} className="btn btnLg btnPrimary w-full gap-2">
                    <Icon name="upload" /> List for Sale
                  </button>
                )}
                <button onClick={() => onDelete(localPet.id)} className="btn btnLg btnDanger gap-2 px-4">
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Info */}
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-surface-warm border border-border w-fit">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-accent" />
              <span className="text-[10px] monoText font-semibold uppercase tracking-widest text-muted">Specimen / {localPet.id.slice(0, 8)}</span>
            </div>
            <h1 className="text-5xl font-medium tracking-tight mb-2">{localPet.displayName}</h1>
            <p className="text-muted monoText text-sm">
              Created by{" "}
              <button onClick={() => window.location.hash = `#/users/${localPet.ownerWallet}`} className="hover:text-accent underline underline-offset-2 transition-colors">
                {localPet.ownerName}
              </button>
            </p>
          </div>

          {/* Price badge */}
          {localPet.isListed && localPet.priceSol && (
            <div className="flex items-center gap-3 p-4 bg-surface-warm border border-border rounded-xl">
              <div className="w-10 h-10 rounded-full bg-ink flex items-center justify-center text-white text-xs font-bold monoText shrink-0">◎</div>
              <div>
                <p className="text-2xl font-bold monoText">{localPet.priceSol.toFixed(3)} SOL</p>
                <p className="text-xs text-muted">Listed for sale on Solana</p>
              </div>
            </div>
          )}

          <div className="h-px bg-border-soft" />
          <p className="text-lg text-muted leading-relaxed max-w-[60ch]">{localPet.description}</p>
          <div className="flex items-center gap-8">
            <PetStats views={localPet.viewCount} downloads={localPet.downloadCount} likes={localPet.likeCount} size="large" />
            <TagPills tags={localPet.tags} />
          </div>

          {/* Specs */}
          <div className="grid grid-cols-3 p-4 bg-surface-warm/50 border border-border rounded-xl gap-6">
            <div className="space-y-1">
              <span className="text-[10px] text-muted monoText uppercase font-bold">Frames</span>
              <p className="text-sm font-medium monoText">{localPet.frames}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted monoText uppercase font-bold">FPS</span>
              <p className="text-sm font-medium monoText">{localPet.fps}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-muted monoText uppercase font-bold">Scale</span>
              <p className="text-sm font-medium monoText">{localPet.scale}×</p>
            </div>
          </div>
        </div>
      </div>

      {/* Animation states grid */}
      <section className="space-y-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-medium">Animations</h2>
          <div className="h-px bg-border-soft flex-1" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
          {ANIMATION_STATES.map((st, i) => (
            <button
              key={st.id}
              onClick={() => setActiveState(st)}
              className={cn("group flex flex-col items-center bg-surface border rounded-xl p-3 transition-all", activeState.id === st.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong")}
            >
              <div className="relative mb-3">
                <span className="absolute -top-1 -left-1 text-[9px] text-subtle monoText font-bold">0{i + 1}</span>
                <SpriteFrame pet={localPet} row={st.row} frames={st.frames} size="thumb" className="border-none bg-transparent" />
                {activeState.id === st.id && <div className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-accent border-2 border-surface" />}
              </div>
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted group-hover:text-foreground transition-colors">{st.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* History card */}
      <section className="space-y-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-medium">History</h2>
          <div className="h-px bg-border-soft flex-1" />
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6">
          <HistoryCard petId={localPet.id} />
        </div>
      </section>

      {/* List for sale modal */}
      <Modal isOpen={showListModal} onClose={() => setShowListModal(false)} title="List for Sale">
        <div className="space-y-5">
          <div className="flex items-center gap-4 bg-surface-warm p-4 rounded-xl border border-border">
            <SpriteFrame pet={localPet} row={0} frames={6} size="thumb" />
            <div>
              <h3 className="font-bold">{localPet.displayName}</h3>
              <p className="text-xs text-muted monoText">{localPet.id}</p>
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted monoText mb-1.5">Price (SOL)</label>
            <div className="flex items-center">
              <span className="h-10 px-3 bg-surface-warm border border-r-0 border-border rounded-l-md flex items-center text-muted monoText">◎</span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                className="flex-1 h-10 px-3 bg-surface-warm border border-border rounded-r-md monoText focus:outline-none focus:border-accent"
                placeholder="e.g. 0.5"
                value={priceSolInput}
                onChange={(e) => setPriceSolInput(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            {isMinted
              ? 'Clicking "List Now" will open Phantom to transfer your NFT to the marketplace escrow. When someone buys it, the SOL and NFT transfer atomically in one transaction.'
              : "When someone buys it, they'll pay this amount in SOL. Ownership and file access transfers immediately after the on-chain confirmation."}
          </p>
          {listError && (
            <p className="text-xs text-red-500 monoText bg-red-50 border border-red-200 rounded-lg px-3 py-2">{listError}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setShowListModal(false); setListError(null); }} className="btn w-full">Cancel</button>
            <button onClick={handleList} disabled={listBusy || !priceSolInput} className="btn btnPrimary w-full gap-2">
              {listBusy ? <Spinner /> : <><Icon name="upload" /> List Now</>}
            </button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

// ── Upload ────────────────────────────────────────────────────────────────────

type MintFlowStep =
  | ""
  | "saving"
  | "ipfs"
  | "minting"
  | "confirming"
  | "listing"
  | "done";

function UploadPage({
  user,
  onSuccess,
}: {
  user: UserProfile | null;
  onSuccess: (pet: Pet) => void;
}) {
  const wallet = useWallet();
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [tags, setTags] = useState<PetTag[]>([]);
  const [priceSol, setPriceSol] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeStep, setActiveStep] = useState<MintFlowStep>("");
  const [doneSteps, setDoneSteps] = useState<MintFlowStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedPet, setSavedPet] = useState<Pet | null>(null);

  // ── not logged in ────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="py-32 flex justify-center">
        <div className="bg-surface border border-border rounded-2xl p-10 max-w-[440px] text-center shadow-lg">
          <div className="w-16 h-16 rounded-2xl bg-surface-warm flex items-center justify-center text-accent mx-auto mb-6">
            <Icon name="user" size={32} />
          </div>
          <p className="text-lg text-foreground mb-2">Connect your wallet to mint.</p>
          <p className="text-muted text-sm mb-8">
            You need a Phantom wallet to mint and publish pets on the marketplace.
          </p>
          <WalletButton user={null} onLogin={() => {}} onLogout={() => {}} className="justify-center" />
        </div>
      </div>
    );
  }

  const listPrice = priceSol ? parseFloat(priceSol) : null;
  const willList = !!listPrice && listPrice > 0;

  const STEPS: { id: MintFlowStep; label: string }[] = [
    { id: "saving",     label: "Saving files" },
    { id: "ipfs",       label: "Pinning to IPFS" },
    { id: "minting",    label: "Mint NFT — confirm in Phantom" },
    { id: "confirming", label: "Waiting for on-chain confirmation" },
    ...(willList
      ? [{ id: "listing" as MintFlowStep, label: "List on marketplace — confirm in Phantom" }]
      : []),
  ];

  function markDone(id: MintFlowStep) {
    setDoneSteps((prev) => [...prev, id]);
    setActiveStep("");
  }

  async function handleMintAndPublish() {
    if (!jsonFile || !sheetFile || !wallet.connected || !wallet.publicKey) return;
    setBusy(true);
    setError(null);
    setDoneSteps([]);
    setSavedPet(null);

    try {
      // ── 1. Upload files to backend ──────────────────────────────────────
      setActiveStep("saving");
      const pet = await api.uploadPet(jsonFile, sheetFile, tags);
      setSavedPet(pet);
      markDone("saving");

      // ── 2. Pin spritesheet + metadata to IPFS ──────────────────────────
      setActiveStep("ipfs");
      const { metadataUri } = await api.pinNftMetadata(pet.id);
      markDone("ipfs");

      // ── 3. Mint NFT on-chain via Phantom ───────────────────────────────
      setActiveStep("minting");
      const umi = getUmi(wallet);
      const mint = generateSigner(umi);
      await create(umi, {
        asset: mint,
        name: pet.displayName,
        uri: metadataUri,
      }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
      markDone("minting");

      // ── 4. Record mint address (wait for RPC propagation) ──────────────
      setActiveStep("confirming");
      await new Promise((r) => setTimeout(r, 4000));
      const mintedPet = await api.recordMintAddress(pet.id, mint.publicKey);
      markDone("confirming");

      // ── 5. List via escrow (optional) ──────────────────────────────────
      if (willList) {
        setActiveStep("listing");
        const config = await api.getNftConfig();
        const asset = await fetchAsset(umi, umiPk(mintedPet.mintAddress!));
        await mplTransfer(umi, {
          asset,
          newOwner: umiPk(config.escrowPublicKey),
        }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
        // Wait for Helius RPC to propagate the transfer before the backend checks it
        await new Promise((r) => setTimeout(r, 4000));
        await api.listPetEscrow(mintedPet.id, listPrice!);
        markDone("listing");
      }

      setActiveStep("done");
      await new Promise((r) => setTimeout(r, 600));
      onSuccess(mintedPet);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      setActiveStep("");
      if (msg.includes("User rejected") || msg.includes("rejected")) {
        setError("Transaction cancelled in Phantom. Your progress is saved — you can retry from your pet's detail page.");
      } else {
        setError(msg || "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!jsonFile && !!sheetFile && wallet.connected && !busy;
  const btnLabel = willList
    ? `Mint & List for ${listPrice} SOL`
    : "Mint & Publish";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="max-w-3xl mx-auto space-y-12"
    >
      {/* Header */}
      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-widest text-accent font-bold monoText">
          New NFT
        </span>
        <h1 className="text-5xl font-medium tracking-tight">Mint & Publish</h1>
        <p className="text-muted text-lg">
          Upload your pet, pin to IPFS, and mint on Solana — all in one step.
        </p>
      </div>

      <div className="bg-surface border border-border p-8 rounded-2xl shadow-sm space-y-10">
        {/* 01 · Files */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <FileDropZone
            label="Pet.json"
            step="01"
            accept=".json"
            icon="package"
            file={jsonFile}
            onChange={setJsonFile}
            hint="application/json"
            disabled={busy}
          />
          <FileDropZone
            label="Spritesheet.webp"
            step="02"
            accept=".webp"
            icon="sheet"
            file={sheetFile}
            onChange={setSheetFile}
            hint="1536×1872 webp"
            disabled={busy}
          />
        </div>

        {/* 03 · Tags */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-accent monoText font-bold text-sm">03</span>
            <label className="text-sm font-semibold uppercase tracking-wider text-muted">
              Tags
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["cute", "weird", "minimal", "animated", "pixel", "hand-drawn"] as PetTag[]).map(
              (t) => (
                <button
                  key={t}
                  disabled={busy}
                  onClick={() =>
                    setTags((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    )
                  }
                  className={cn(
                    "px-4 h-9 rounded-full border text-xs font-semibold uppercase tracking-widest transition-all",
                    tags.includes(t)
                      ? "bg-ink border-ink text-white"
                      : "bg-transparent border-border hover:border-border-strong text-muted"
                  )}
                >
                  {t}
                </button>
              )
            )}
          </div>
        </div>

        {/* 04 · Price */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-accent monoText font-bold text-sm">04</span>
            <label className="text-sm font-semibold uppercase tracking-wider text-muted">
              List Price{" "}
              <span className="font-normal normal-case text-subtle">(optional)</span>
            </label>
          </div>
          <div className="flex items-center max-w-xs">
            <span className="h-10 px-3 bg-surface-warm border border-r-0 border-border rounded-l-md flex items-center text-muted monoText">
              ◎ SOL
            </span>
            <input
              type="number"
              min="0.001"
              step="0.001"
              disabled={busy}
              className="flex-1 h-10 px-3 bg-surface-warm border border-border rounded-r-md monoText focus:outline-none focus:border-accent disabled:opacity-50"
              placeholder="0.00 — leave blank to mint privately"
              value={priceSol}
              onChange={(e) => setPriceSol(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted">
            {willList
              ? "Your NFT will be sent to the marketplace escrow and listed immediately after minting. Requires a second Phantom confirmation."
              : "Leave blank to mint to your wallet privately. You can list for sale later from the pet's detail page."}
          </p>
        </div>

        {/* Submit area */}
        <div className="pt-8 border-t border-border-soft space-y-5">
          {/* Step tracker — visible while busy */}
          {busy && (
            <div className="p-4 bg-surface-warm rounded-xl border border-border space-y-3">
              {STEPS.map((s) => {
                const done = doneSteps.includes(s.id);
                const active = activeStep === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 text-sm transition-colors duration-200",
                      done
                        ? "text-foreground"
                        : active
                        ? "text-accent"
                        : "text-muted/40"
                    )}
                  >
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      {done ? (
                        <Icon name="check" size={14} className="text-accent" />
                      ) : active ? (
                        <Spinner />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-current" />
                      )}
                    </div>
                    <span className="monoText font-medium">{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 rounded-xl border border-red-200 space-y-1.5">
              <p className="text-sm text-red-600 font-medium">{error}</p>
              {savedPet && (
                <p className="text-xs text-red-500 monoText">
                  Files saved as{" "}
                  <button
                    onClick={() => (window.location.hash = `#/pets/${savedPet.id}`)}
                    className="underline hover:text-red-700"
                  >
                    {savedPet.displayName}
                  </button>
                  . Visit the detail page to retry minting.
                </p>
              )}
            </div>
          )}

          {/* CTA row */}
          <div className="flex items-end justify-between gap-6">
            {/* What happens summary */}
            <div className="text-xs text-muted space-y-1 leading-relaxed">
              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider monoText">
                What happens
              </p>
              <p>① Files saved · ② Pinned to IPFS (Pinata)</p>
              <p>③ NFT minted on Solana mainnet</p>
              {willList && <p>④ Listed on marketplace via escrow</p>}
            </div>

            <button
              className="btn btnLg btnPrimary shrink-0 min-w-[220px] gap-2"
              disabled={!canSubmit}
              onClick={handleMintAndPublish}
            >
              {busy ? (
                <Spinner />
              ) : (
                <Icon name="sparkles" />
              )}
              {busy ? "In progress…" : btnLabel}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FileDropZone({ label, step, accept, icon, file, onChange, hint, disabled = false }: { label: string; step: string; accept: string; icon: string; file: File | null; onChange: (f: File | null) => void; hint: string; disabled?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-accent monoText font-bold text-sm">{step}</span>
        <label className="text-sm font-semibold uppercase tracking-wider text-muted">{label}</label>
      </div>
      <div className={cn("h-48 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer", file ? "border-accent bg-accent-soft/10" : "border-border-strong hover:bg-surface-warm", disabled && "opacity-50 pointer-events-none")}>
        <input type="file" className="hidden" id={`fu-${step}`} accept={accept} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        <label htmlFor={`fu-${step}`} className="flex flex-col items-center cursor-pointer p-4 w-full h-full justify-center">
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center mb-1", file ? "bg-accent text-white" : "bg-surface-warm text-muted")}>
            <Icon name={icon as any} size={24} />
          </div>
          <span className="text-sm font-medium">{file ? file.name : "Select file"}</span>
          {!file && <span className="text-xs text-muted">{hint}</span>}
        </label>
      </div>
    </div>
  );
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function FavoritesPage({ user, navigate, handleLike, likeBusyId, onShare, onBuy }: { user: UserProfile | null; navigate: any; handleLike: any; likeBusyId: string | null; onShare: (p: Pet) => void; onBuy: (p: Pet) => void }) {
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      // Fetch all pets where we have a like
      try {
        const all = await api.getPets({});
        setPets(all.filter((p) => p.likedByMe));
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user) return (
    <div className="py-32 flex justify-center">
      <div className="bg-surface border border-border rounded-2xl p-10 max-w-[440px] text-center shadow-lg">
        <Icon name="heart" size={32} className="text-accent mx-auto mb-4" />
        <p className="text-lg mb-6">Connect wallet to see your favorites.</p>
        <WalletButton user={null} onLogin={() => {}} onLogout={() => {}} className="justify-center" />
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="mb-10">
        <span className="text-[11px] uppercase tracking-widest text-accent font-bold monoText">{user.displayName ?? user.wallet.slice(0, 8)}</span>
        <h1 className="text-5xl font-medium tracking-tight">Favorites</h1>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">{[...Array(4)].map((_, i) => <PetCardSkeleton key={i} index={i} />)}</div>
      ) : pets.length === 0 ? (
        <div className="py-24 text-center bg-surface-warm/30 rounded-xl border border-dashed border-border flex flex-col items-center">
          <Icon name="heart" size={32} className="text-muted mb-4" />
          <h3 className="text-xl font-medium mb-1">No favorites yet</h3>
          <p className="text-muted">Explore the marketplace and heart the ones you love.</p>
          <button onClick={() => navigate("#/")} className="btn btnPrimary mt-6">Explore Marketplace</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {pets.map((pet, i) => (
            <div key={pet.id} className="revealItem" style={{ "--delay": `${i * 60}ms` } as any}>
              <PetCard pet={pet} onClick={() => navigate(`#/pets/${pet.id}`)} onLike={() => handleLike(pet)} onShare={() => onShare(pet)} onBuy={pet.isListed ? () => onBuy(pet) : undefined} isLikeBusy={likeBusyId === pet.id} />
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── My Uploads ────────────────────────────────────────────────────────────────

function MyUploadsPage({ user, navigate }: { user: UserProfile | null; navigate: any }) {
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try { setPets(await api.getMyPets()); } finally { setLoading(false); }
    })();
  }, [user]);

  if (!user) return (
    <div className="py-32 flex justify-center">
      <div className="bg-surface border border-border rounded-2xl p-10 max-w-[440px] text-center shadow-lg">
        <Icon name="package" size={32} className="text-accent mx-auto mb-4" />
        <p className="text-lg mb-6">Connect wallet to manage your pets.</p>
        <WalletButton user={null} onLogin={() => {}} onLogout={() => {}} className="justify-center" />
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 mb-10">
        <div>
          <span className="text-[11px] uppercase tracking-widest text-accent font-bold monoText">{user.displayName ?? user.wallet.slice(0, 8)}</span>
          <h1 className="text-5xl font-medium tracking-tight">Your Pets</h1>
        </div>
        <button onClick={() => navigate("#/upload")} className="btn btnLg btnPrimary gap-2"><Icon name="upload" /> Upload New Pet</button>
      </div>

      {loading ? (
        <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-surface border border-border-soft animate-skel rounded-xl" />)}</div>
      ) : pets.length === 0 ? (
        <div className="py-24 text-center bg-surface-warm/30 rounded-xl border border-dashed border-border flex flex-col items-center">
          <Icon name="package" size={32} className="text-muted mb-4" />
          <h3 className="text-xl font-medium mb-1">No pets yet</h3>
          <p className="text-muted">Upload your first companion pet.</p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border-soft">
          {pets.map((pet) => (
            <div key={pet.id} className="p-4 flex flex-col md:flex-row md:items-center gap-4 hover:bg-surface-warm/30 transition-colors">
              <SpriteFrame pet={pet} row={0} frames={6} size="thumb" onClick={() => navigate(`#/pets/${pet.id}`)} />
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold truncate text-lg">{pet.displayName}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted monoText truncate">id: {pet.id}</p>
                  {pet.isListed && <span className="text-[10px] bg-accent text-white px-2 py-0.5 rounded-full monoText font-bold">Listed · {pet.priceSol?.toFixed(3)} SOL</span>}
                </div>
              </div>
              <div className="flex items-center gap-6">
                <PetStats views={pet.viewCount} downloads={pet.downloadCount} likes={pet.likeCount} />
                <span className="text-xs text-muted monoText hidden lg:block">{formatDate(pet.createdAt)}</span>
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => downloadPetFiles(pet.id)} className="btn btnSm gap-1"><Icon name="package" size={14} /> Download</button>
                <button onClick={() => navigate(`#/pets/${pet.id}`)} className="btn btnSm">View</button>
                <button
                  onClick={async () => {
                    if (window.confirm(`Delete ${pet.displayName}?`)) {
                      await api.deletePet(pet.id);
                      setPets((prev) => prev.filter((p) => p.id !== pet.id));
                    }
                  }}
                  className="btn btnSm btnDanger p-2"
                ><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── User Profile ──────────────────────────────────────────────────────────────

function UserPage({ userId, currentUser, navigate, handleLike, likeBusyId, onShare, onBuy, onUpdateUser, onLogout }: {
  userId: string;
  currentUser: UserProfile | null;
  navigate: any;
  handleLike: any;
  likeBusyId: string | null;
  onShare: (p: Pet) => void;
  onBuy: (p: Pet) => void;
  onUpdateUser: (u: UserProfile) => void;
  onLogout: () => void;
}) {
  const { disconnect, select } = useWallet();
  const [data, setData] = useState<{ displayName: string | null; petCount: number; pets: Pet[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const isOwnProfile = currentUser?.wallet === userId;

  // Settings state (only used on own profile)
  const [nameInput, setNameInput] = useState(currentUser?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => { setNameInput(currentUser?.displayName ?? ""); }, [currentUser]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await api.getUserPage(userId);
        setData(res);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (notFound) return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-32 text-center">
      <h2 className="text-2xl font-medium mb-2">Creator not found</h2>
      <button onClick={() => navigate("#/")} className="btn btnPrimary mt-4">Back to Marketplace</button>
    </motion.div>
  );

  const displayName = isOwnProfile
    ? (currentUser?.displayName ?? userId.slice(0, 12) + "…")
    : (data?.displayName ?? userId.slice(0, 12) + "…");

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-10">
      {/* Profile header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 pb-10 border-b border-border-soft">
        <div className="w-20 h-20 rounded-2xl bg-surface-soft border border-border flex items-center justify-center text-muted shrink-0">
          <Icon name="user" size={36} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] uppercase tracking-widest text-accent font-bold monoText">
            {isOwnProfile ? "Your Profile" : "Creator"}
          </span>
          {loading ? (
            <div className="w-48 h-8 bg-surface-soft rounded mt-1 animate-pulse" />
          ) : (
            <h1 className="text-4xl font-medium tracking-tight truncate">{displayName}</h1>
          )}
          <p className="text-muted monoText text-xs mt-1 truncate">{userId}</p>
          {!loading && (
            <p className="text-muted monoText text-sm mt-0.5">
              {data?.petCount ?? 0} pet{(data?.petCount ?? 0) !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Own-profile actions */}
        {isOwnProfile && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => navigate("#/upload")}
              className="btn btnPrimary gap-2"
            >
              <Icon name="upload" size={15} /> Upload Pet
            </button>
            <button
              onClick={async () => { await api.logout(); await disconnect().catch(() => {}); select(null as any); onLogout(); navigate("#/"); }}
              className="btn gap-2 text-red-500 border-red-200 hover:bg-red-50"
              title="Disconnect wallet"
            >
              <Icon name="logout" size={15} /> Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Own-profile settings panel */}
      {isOwnProfile && (
        <div className="bg-surface border border-border rounded-2xl p-6">
          <h2 className="text-base font-semibold mb-4">Account Settings</h2>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex-1 max-w-sm">
              <label className="block text-[11px] uppercase tracking-wider text-muted monoText mb-1.5">Display Name</label>
              <input
                type="text"
                className="w-full bg-surface-warm border border-border rounded-md h-10 px-3 monoText focus:outline-none focus:border-accent transition-colors"
                value={nameInput}
                onChange={(e) => { setNameInput(e.target.value); setNameSaved(false); }}
                placeholder="Enter display name…"
              />
            </div>
            <button
              className="btn btnPrimary h-10 px-5 mt-4 sm:mt-[18px] gap-2 shrink-0"
              disabled={savingName || nameInput === currentUser?.displayName}
              onClick={async () => {
                setSavingName(true);
                try {
                  const updated = await api.updateDisplayName(nameInput);
                  onUpdateUser({ ...currentUser!, displayName: updated.displayName });
                  setNameSaved(true);
                } finally {
                  setSavingName(false);
                }
              }}
            >
              {savingName ? <Spinner /> : nameSaved ? <><Icon name="check" size={14} /> Saved</> : "Save"}
            </button>
          </div>
          <div className="mt-3">
            <label className="block text-[11px] uppercase tracking-wider text-muted monoText mb-1.5">Wallet Address</label>
            <p className="monoText text-xs text-muted bg-surface-warm border border-border rounded-md px-3 py-2.5 break-all">{userId}</p>
          </div>
        </div>
      )}

      {/* Pets grid */}
      <div>
        <h2 className="text-xl font-medium mb-6">{isOwnProfile ? "Your Pets" : "Pets"}</h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(3)].map((_, i) => <PetCardSkeleton key={i} index={i} />)}
          </div>
        ) : !data?.pets.length ? (
          <div className="py-24 text-center bg-surface-warm/30 rounded-xl border border-dashed border-border flex flex-col items-center">
            <Icon name="package" size={32} className="text-muted mb-4" />
            <h3 className="text-xl font-medium mb-1">No pets yet</h3>
            {isOwnProfile && (
              <button onClick={() => navigate("#/upload")} className="btn btnPrimary mt-4 gap-2">
                <Icon name="upload" size={15} /> Upload your first pet
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {data.pets.map((pet, i) => (
              <div key={pet.id} className="revealItem" style={{ "--delay": `${i * 60}ms` } as any}>
                <PetCard
                  pet={pet}
                  onClick={() => navigate(`#/pets/${pet.id}`)}
                  onLike={() => handleLike(pet)}
                  onShare={() => onShare(pet)}
                  onBuy={pet.isListed ? () => onBuy(pet) : undefined}
                  isLikeBusy={likeBusyId === pet.id}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Share Modal ───────────────────────────────────────────────────────────────

function ShareModal({ pet, isOpen, onClose }: { pet: Pet | null; isOpen: boolean; onClose: () => void }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  if (!pet) return null;

  const petUrl = `${window.location.origin}${window.location.pathname}#/pets/${pet.id}`;
  const copy = (text: string, key: string) => { navigator.clipboard.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1400); };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Pet" width="560px">
      <div className="space-y-6">
        <div className="flex items-center gap-4 bg-surface-warm p-4 rounded-xl border border-border">
          <SpriteFrame pet={pet} row={0} frames={6} size="thumb" />
          <div>
            <h3 className="font-bold">{pet.displayName}</h3>
            <p className="text-xs text-muted monoText">{pet.id}</p>
            {pet.isListed && <p className="text-xs text-accent font-medium monoText mt-1">Listed for {pet.priceSol?.toFixed(3)} SOL</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-widest text-muted monoText font-bold">Pet Link</label>
          <div className="flex bg-ink rounded-lg overflow-hidden h-10">
            <div className="flex-1 px-3 flex items-center overflow-hidden">
              <code className="text-accent/80 text-xs truncate monoText">{petUrl}</code>
            </div>
            <button onClick={() => copy(petUrl, "url")} className="bg-white/10 hover:bg-white/20 text-white w-24 flex items-center justify-center text-[10px] font-bold monoText transition-all border-l border-white/5">
              {copiedKey === "url" ? "COPIED" : "COPY"}
            </button>
          </div>
        </div>
        <div className="pt-4 border-t border-border flex justify-center">
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out this Codex companion pet: ${pet.displayName}!\n\n${petUrl}`)}`} target="_blank" rel="noreferrer" className="btn btnPrimary gap-2">
            <Icon name="share" /> Share on Twitter
          </a>
        </div>
      </div>
    </Modal>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────

function PetCardSkeleton({ index }: { index: number }) {
  return (
    <div className="bg-surface rounded-lg border border-border-soft overflow-hidden h-[420px] revealItem" style={{ "--delay": `${index * 60}ms` } as any}>
      <div className="h-[196px] bg-surface-soft relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent translate-x-[-100%] animate-skel" />
      </div>
      <div className="p-4 space-y-3">
        <div className="flex justify-between"><div className="w-24 h-3 bg-surface-soft rounded" /><div className="w-16 h-3 bg-surface-soft rounded" /></div>
        <div className="w-2/3 h-5 bg-surface-soft rounded" />
        <div className="w-full h-3 bg-surface-soft rounded" />
        <div className="w-4/5 h-3 bg-surface-soft rounded" />
        <div className="flex gap-2 mt-4"><div className="w-12 h-6 bg-surface-soft rounded-full" /><div className="w-12 h-6 bg-surface-soft rounded-full" /></div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-12 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,600px] gap-12">
        <div className="h-[400px] bg-surface-soft rounded-2xl" />
        <div className="space-y-6">
          <div className="w-32 h-6 bg-surface-soft rounded" />
          <div className="w-2/3 h-16 bg-surface-soft rounded" />
          <div className="w-48 h-4 bg-surface-soft rounded" />
          <div className="h-px bg-border-soft" />
          <div className="space-y-3"><div className="w-full h-4 bg-surface-soft rounded" /><div className="w-2/3 h-4 bg-surface-soft rounded" /></div>
        </div>
      </div>
    </div>
  );
}
