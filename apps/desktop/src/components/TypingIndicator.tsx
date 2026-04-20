import { motion } from 'framer-motion';
import { useLang } from '../lib/i18n';

export default function TypingIndicator() {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-1 py-1">
      <span className="text-xs text-vortex-400 font-medium">{t('typingText')}</span>
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full bg-vortex-400"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
