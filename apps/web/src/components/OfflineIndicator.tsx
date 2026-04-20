import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Clock } from 'lucide-react';
import { getSocketConnectionStatus } from '../lib/socket';
import { getQueue } from '../lib/messageQueue';

export default function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    const check = () => {
      const connected = getSocketConnectionStatus();
      setIsOffline(!connected);
      setQueuedCount(connected ? 0 : getQueue().length);
    };

    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium"
        >
          <WifiOff size={16} />
          <span>Нет подключения</span>
          {queuedCount > 0 && (
            <span className="flex items-center gap-1 ml-1 bg-white/20 px-2 py-0.5 rounded-full text-xs">
              <Clock size={11} />
              {queuedCount} в очереди
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
