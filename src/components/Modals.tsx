import React, { useState, useEffect } from "react";
import { cn } from "../lib/utils";
import { Icon, Spinner } from "./Icons";
import { motion, AnimatePresence } from "motion/react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
  isBusy?: boolean;
}

export function Modal({ isOpen, onClose, title, children, width = "420px", isBusy }: ModalProps) {
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "unset";
    return () => { document.body.style.overflow = "unset"; };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink/60 backdrop-blur-sm" 
            onClick={() => !isBusy && onClose()}
          />
          <motion.div 
            initial={{ opacity: 0, translateY: 8, scale: 0.98 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={{ opacity: 0, translateY: 8, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.34, 1.56, 0.64, 1] }}
            className="relative bg-surface rounded-xl shadow-modal overflow-hidden flex flex-col"
            style={{ width, maxWidth: "100%" }}
          >
            {title && (
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="text-xl font-medium tracking-tight">{title}</h2>
                <button onClick={onClose} disabled={isBusy} className="text-muted hover:text-foreground transition-colors p-1">
                  <Icon name="close" size={20} />
                </button>
              </div>
            )}
            <div className="p-6 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function AuthModal({
  isOpen, onClose, onSignInWithGoogle, onDevLogin
}: {
  isOpen: boolean; onClose: () => void; onSignInWithGoogle: () => Promise<void>; onDevLogin?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSignInWithGoogle();
      onClose();
    } catch (e) {
      setError("Failed to sign in with Google.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign In" isBusy={busy}>
      <div className="flex flex-col items-center text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-surface-warm flex items-center justify-center text-accent">
          <Icon name="user" size={32} />
        </div>

        <div>
          <h3 className="text-lg font-medium mb-1">Welcome to PetX</h3>
          <p className="text-sm text-muted">Join the community to upload and favorite companion pets.</p>
        </div>

        <button
          className="btn btnLg btnPrimary w-full gap-2 flex items-center justify-center"
          onClick={handleGoogle}
          disabled={busy}
        >
          {busy ? <Spinner /> : <Icon name="user" size={18} />}
          {busy ? "Signing in..." : "Sign in with Google"}
        </button>

        {onDevLogin && (
          <button
            className="btn w-full gap-2 border-dashed border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 text-xs monoText"
            onClick={() => { onDevLogin(); onClose(); }}
          >
            ⚡ Dev bypass — skip auth
          </button>
        )}

        {error && <p className="text-sm text-red-500 font-mono" role="alert">{error}</p>}

        <p className="text-xs text-muted pt-4 border-t border-border w-full">
          Browsing and downloading do not require an account.
        </p>
      </div>
    </Modal>
  );
}
