import React from "react";
import { Pet, PetTag } from "../types";
import { cn } from "../lib/utils";
import { SpriteFrame, PetStats } from "./SpriteFrame";
import { Icon, Spinner, IconName } from "./Icons";

interface TagPillsProps {
  tags: PetTag[];
  activeTags?: PetTag[];
  onToggle?: (tag: PetTag) => void;
  variant?: "filter" | "display";
  className?: string;
}

export function TagPills({ tags, activeTags = [], onToggle, variant = "display", className }: TagPillsProps) {
  if (variant === "filter") {
    const allTags: PetTag[] = ["cute", "weird", "minimal", "animated", "pixel", "hand-drawn"];
    return (
      <div className={cn("flex flex-wrap gap-2", className)} aria-label="Tag filters">
        <button
          onClick={() => onToggle?.("" as any)}
          className={cn("h-7 px-3 rounded-full text-[11.5px] monoText border transition-all", activeTags.length === 0 ? "bg-ink text-white border-ink" : "bg-transparent border-border hover:border-border-strong text-muted")}
        >
          All
        </button>
        {allTags.map((tag) => (
          <button
            key={tag}
            onClick={() => onToggle?.(tag)}
            className={cn("h-7 px-3 rounded-full text-[11.5px] monoText border transition-all", activeTags.includes(tag) ? "bg-ink text-white border-ink" : "bg-transparent border-border hover:border-border-strong text-muted")}
          >
            {tag}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <span key={tag} className="h-6 px-2 rounded-sm border border-border-soft text-[11px] text-subtle lowercase bg-surface-soft/30 flex items-center">
          {tag}
        </span>
      ))}
    </div>
  );
}

interface PetCardProps {
  pet: Pet;
  onLike: (e: React.MouseEvent) => void;
  onShare: (e: React.MouseEvent) => void;
  /** Called when the user wants to buy — only provided when pet.isListed */
  onBuy?: (e: React.MouseEvent) => void;
  onClick: () => void;
  isLikeBusy?: boolean;
}

export function PetCard({ pet, onLike, onShare, onBuy, onClick, isLikeBusy }: PetCardProps) {
  const getTagIcon = (tag: PetTag): IconName | null => {
    switch (tag) {
      case "cute":       return "sparkles";
      case "animated":   return "flame";
      case "pixel":      return "pixel";
      case "minimal":    return "minimal";
      case "hand-drawn": return "draw";
      case "weird":      return "weird";
      default:           return null;
    }
  };

  const primaryTagIcon = getTagIcon(pet.tags[0]);

  return (
    <div
      className="group bg-surface rounded-lg border border-border shadow-sm flex flex-col min-h-[420px] transition-all duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Sprite preview */}
      <div className="w-full h-[260px] bg-white flex items-center justify-center overflow-hidden border-b border-border-soft relative">
        <SpriteFrame pet={pet} row={0} frames={6} size="medium" className="border-none" />

        {/* Price badge overlay */}
        {pet.isListed && pet.priceSol != null && (
          <div className="absolute top-2 right-2 flex items-center gap-1 bg-ink/90 text-white px-2 py-1 rounded-md monoText text-[11px] font-bold">
            <span className="text-accent">◎</span>
            {pet.priceSol.toFixed(3)}
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-1">
          <button
            className="text-[11px] text-muted monoText truncate max-w-[60%] hover:text-accent transition-colors"
            onClick={(e) => { e.stopPropagation(); window.location.hash = `#/users/${pet.ownerWallet}`; }}
          >
            {pet.ownerName}
          </button>
          <PetStats views={pet.viewCount} downloads={pet.downloadCount} likes={pet.likeCount} />
        </div>

        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-medium leading-tight text-foreground truncate">{pet.displayName}</h3>
          {primaryTagIcon && (
            <div className={cn(
              "p-1 rounded-full shrink-0",
              pet.tags[0] === "animated"   && "bg-orange-100 text-orange-600",
              pet.tags[0] === "cute"       && "bg-pink-100 text-pink-600",
              pet.tags[0] === "pixel"      && "bg-blue-100 text-blue-600",
              pet.tags[0] === "minimal"    && "bg-slate-100 text-slate-600",
              pet.tags[0] === "weird"      && "bg-purple-100 text-purple-600",
              pet.tags[0] === "hand-drawn" && "bg-emerald-100 text-emerald-600",
            )}>
              <Icon name={primaryTagIcon} size={12} strokeWidth={2} />
            </div>
          )}
        </div>

        <p className="text-[13px] text-muted line-clamp-2 mb-4 leading-relaxed">{pet.description}</p>
        <TagPills tags={pet.tags} className="mt-auto" />
      </div>

      {/* Card footer actions */}
      <div className="p-2 border-t border-border-soft flex gap-1 bg-surface-warm/30">
        <button
          className="btn btnSm flex-1 gap-1.5"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          <Icon name="eye" size={13} /> View
        </button>

        {/* Buy button — only when listed */}
        {onBuy && (
          <button
            className="btn btnSm btnPrimary flex-1 gap-1.5"
            onClick={(e) => { e.stopPropagation(); onBuy(e); }}
          >
            <span className="text-[11px]">◎</span>
            Buy
          </button>
        )}

        <button
          className={cn("btn btnSm px-2 gap-1.5", pet.likedByMe ? "bg-accent-soft border-accent/30 text-accent-deep hover:bg-accent-soft/80" : "")}
          onClick={(e) => { e.stopPropagation(); onLike(e); }}
          disabled={isLikeBusy}
        >
          {isLikeBusy ? <Spinner size={13} /> : <Icon name="heart" size={13} className={pet.likedByMe ? "fill-current" : ""} />}
        </button>

        <button
          className="btn btnSm px-2"
          onClick={(e) => { e.stopPropagation(); onShare(e); }}
        >
          <Icon name="share" size={13} />
        </button>
      </div>
    </div>
  );
}
