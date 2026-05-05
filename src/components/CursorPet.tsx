import { useEffect, useRef, useState } from "react";
import { Pet } from "../types";

type AnimDir = "idle" | "running-right" | "running-left";

const DIR_CONFIG: Record<AnimDir, { row: number; frames: number }> = {
  "idle":          { row: 0, frames: 6 },
  "running-right": { row: 1, frames: 8 },
  "running-left":  { row: 2, frames: 8 },
};

export function CursorPet({ pet }: { pet: Pet }) {
  const petRef      = useRef<HTMLDivElement>(null);
  const posRef      = useRef({ x: window.innerWidth / 2, y: window.innerHeight - 120 });
  const targetRef   = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const rafRef      = useRef<number>(0);
  const dirRef      = useRef<AnimDir>("idle");
  const [animDir, setAnimDir] = useState<AnimDir>("idle");

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      targetRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMouseMove);

    function tick() {
      const pos    = posRef.current;
      const target = targetRef.current;
      const vx     = (target.x - pos.x) * 0.1;
      const vy     = (target.y - pos.y) * 0.1;
      pos.x += vx;
      pos.y += vy;

      const newDir: AnimDir =
        Math.abs(vx) > 0.5
          ? vx > 0
            ? "running-right"
            : "running-left"
          : "idle";

      if (newDir !== dirRef.current) {
        dirRef.current = newDir;
        setAnimDir(newDir);
      }

      if (petRef.current) {
        petRef.current.style.left = `${pos.x}px`;
        petRef.current.style.top  = `${pos.y}px`;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const { row, frames } = DIR_CONFIG[animDir];

  return (
    <>
      {/* Green glow border around the whole page */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 9998,
          animation: "petGlow 2s ease-in-out infinite",
          boxShadow:
            "rgba(101,163,13,0.5) 0px 0px 12px inset, " +
            "rgba(101,163,13,0.25) 0px 0px 28px inset, " +
            "rgba(101,163,13,0.1) 0px 0px 50px inset",
        }}
      />

      {/* Walking pet — positioned via direct DOM mutation in RAF */}
      <div
        ref={petRef}
        style={{
          position: "fixed",
          left: posRef.current.x,
          top: posRef.current.y,
          zIndex: 9999,
          pointerEvents: "none",
          width: 96,
          height: 104,
          transform: "translate(-50%, -50%)",
          overflow: "hidden",
        }}
      >
        <div
          className="sprite absolute top-0 left-0 origin-top-left"
          style={{
            "--sprite-y":        `${row * -208}px`,
            "--sprite-end-x":    `${frames * -192}px`,
            "--sprite-frames":   frames,
            "--sprite-duration": `${frames * 100}ms`,
            transform:           "scale(0.5) translate3d(0,0,0)",
            backgroundImage:     `url(${pet.spritesheetUrl})`,
          } as React.CSSProperties}
        />
      </div>
    </>
  );
}
