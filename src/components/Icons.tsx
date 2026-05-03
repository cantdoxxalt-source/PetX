import {
  Check, X, Copy, Download, Eye, Heart, Package, Search, Share2, FileImage, Tag, Terminal, Trash2, Upload, User, LogOut,
  Sparkles, Flame, Grid3X3, Shapes, Pencil, Activity
} from "lucide-react";
import { cn } from "../lib/utils";

const ICONS = {
  check: Check,
  close: X,
  copy: Copy,
  download: Download,
  eye: Eye,
  heart: Heart,
  package: Package,
  search: Search,
  share: Share2,
  sheet: FileImage,
  tag: Tag,
  terminal: Terminal,
  trash: Trash2,
  upload: Upload,
  user: User,
  sparkles: Sparkles,
  flame: Flame,
  pixel: Grid3X3,
  minimal: Shapes,
  draw: Pencil,
  weird: Activity,
  logout: LogOut,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, className, size = 16, strokeWidth = 1.5 }: IconProps) {
  const LucideIcon = ICONS[name];
  if (!LucideIcon) return null;
  
  return (
    <LucideIcon 
      className={cn("shrink-0", className)} 
      size={size} 
      strokeWidth={strokeWidth} 
    />
  );
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg 
      className={cn("animate-spin text-current", className)} 
      width={size} 
      height={size} 
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
