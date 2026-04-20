import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useLang } from '../lib/i18n';

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useLang();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-full max-w-[360px] mx-4 rounded-2xl bg-surface-secondary border border-border/50 shadow-2xl overflow-hidden"
          >
            <div className="p-5 flex flex-col items-center text-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${danger ? 'bg-red-500/15' : 'bg-accent/15'}`}>
                <AlertTriangle size={24} className={danger ? 'text-red-400' : 'text-accent'} />
              </div>
              {title && (
                <h3 className="text-white text-base font-semibold mb-1">{title}</h3>
              )}
              <p className="text-zinc-400 text-sm leading-relaxed">{message}</p>
            </div>
            <div className="flex border-t border-border/40">
              <button
                onClick={onCancel}
                className="flex-1 py-3 text-sm font-medium text-zinc-400 hover:bg-surface-hover hover:text-white transition-colors"
              >
                {cancelText || t('cancel')}
              </button>
              <div className="w-px bg-border/40" />
              <button
                onClick={onConfirm}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  danger
                    ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                    : 'text-accent hover:bg-accent/10'
                }`}
              >
                {confirmText || t('confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
