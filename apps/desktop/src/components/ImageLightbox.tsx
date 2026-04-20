import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageLightboxProps {
  url?: string;
  images?: { url: string; type?: string }[];
  initialIndex?: number;
  onClose: () => void;
}

export default function ImageLightbox({ url, images, initialIndex = 0, onClose }: ImageLightboxProps) {
  const gallery = images && images.length > 0;
  const [index, setIndex] = useState(initialIndex);
  const currentUrl = gallery ? images![index].url : url!;
  const currentType = gallery ? images![index].type : undefined;
  const total = gallery ? images!.length : 1;

  const goPrev = useCallback(() => {
    if (gallery) setIndex((i) => (i > 0 ? i - 1 : total - 1));
  }, [gallery, total]);

  const goNext = useCallback(() => {
    if (gallery) setIndex((i) => (i < total - 1 ? i + 1 : 0));
  }, [gallery, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        {gallery && total > 1 && (
          <span className="text-sm text-white/70 mr-2">{index + 1} / {total}</span>
        )}
        <a
          href={currentUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <Download size={20} />
        </a>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Left arrow */}
      {gallery && total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Right arrow */}
      {gallery && total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronRight size={28} />
        </button>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={currentUrl}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        >
          {currentType === 'video' ? (
            <video
              src={currentUrl}
              controls
              autoPlay
              className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
            />
          ) : (
            <img
              src={currentUrl}
              alt=""
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>,
    document.body
  );
}
