import React, { useMemo } from "react";
import { Pet, ANIMATION_STATES } from "../types";
import { cn, formatCompactNumber } from "../lib/utils";
import { Icon, Spinner } from "./Icons";

interface SpriteFrameProps {
  pet: Pet;
  row: number;
  frames: number;
  size?: "thumb" | "small" | "medium" | "large";
  className?: string;
  onClick?: () => void;
}

export function SpriteFrame({ pet, row, frames, size = "medium", className, onClick }: SpriteFrameProps) {
  const [hasError, setHasError] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);

  const dimensions = {
    thumb: { w: 56, h: 60, scale: 0.288 },
    small: { w: 112, h: 122, scale: 0.583 },
    medium: { w: 192, h: 208, scale: 1.0 },
    large: { w: 360, h: 390, scale: 1.875 },
  }[size];

  const style = useMemo(() => ({
    "--sprite-y": `${row * -208}px`,
    "--sprite-end-x": `${frames * -192}px`,
    "--sprite-frames": frames,
    "--sprite-duration": `${frames * 100}ms`, // Faster, crisper 10fps
    transform: `scale(${dimensions.scale}) translate3d(0,0,0)`,
  } as React.CSSProperties), [row, frames, dimensions.scale]);

  return (
    <div 
      className={cn(
        "relative overflow-hidden bg-white border border-border-soft flex items-center justify-center shrink-0 cursor-pointer group",
        size === "thumb" && "rounded-sm",
        size === "small" && "rounded-sm",
        size === "medium" && "rounded-md",
        size === "large" && "rounded-lg",
        className
      )}
      style={{ width: dimensions.w, height: dimensions.h }}
      onClick={onClick}
      role="img"
      aria-label={`${pet.displayName} sprite preview`}
    >
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-warm animate-pulse">
          <Spinner size={size === "thumb" ? 14 : 24} />
        </div>
      )}
      {hasError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-soft text-subtle p-2 text-center">
          <Icon name="package" size={size === "thumb" ? 16 : 32} className="mb-1 opacity-50" />
          {size !== "thumb" && <span className="text-[10px] font-bold uppercase monoText">Asset missing</span>}
        </div>
      ) : (
        <>
          {/* Preload image to handle states */}
          <img 
            src={pet.spritesheetUrl} 
            className="hidden" 
            onLoad={() => setIsLoaded(true)} 
            onError={() => { setHasError(true); setIsLoaded(true); }} 
            alt=""
          />
          <div 
            className={cn(
              "sprite absolute top-0 left-0 origin-top-left transition-opacity duration-300",
              isLoaded ? "opacity-100" : "opacity-0"
            )} 
            style={{ 
              ...style,
              backgroundImage: `url(${pet.spritesheetUrl})`
            }} 
          />
        </>
      )}
    </div>
  );
}

export function PetStats({ 
  views, downloads, likes, size = "normal", className 
}: { 
  views: number; downloads: number; likes: number; size?: "normal" | "large"; className?: string 
}) {
  return (
    <div className={cn(
      "flex items-center gap-3 petStats",
      size === "normal" ? "text-[11px] text-muted uppercase tracking-wider" : "text-[12px] text-foreground font-medium",
      className
    )}>
      <div className="flex items-center gap-1">
        <Icon name="eye" size={size === "normal" ? 12 : 14} />
        <span>{formatCompactNumber(views)}</span>
      </div>
      <div className="flex items-center gap-1">
        <Icon name="download" size={size === "normal" ? 12 : 14} />
        <span>{formatCompactNumber(downloads)}</span>
      </div>
      <div className="flex items-center gap-1">
        <Icon name="heart" size={size === "normal" ? 12 : 14} />
        <span>{formatCompactNumber(likes)}</span>
      </div>
    </div>
  );
}
