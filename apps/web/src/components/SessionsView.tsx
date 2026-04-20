import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Smartphone, Trash2, Loader2, Shield } from 'lucide-react';
import { api } from '../lib/api';
import type { Session } from '../lib/types';

export default function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminating, setTerminating] = useState<string | null>(null);

  useEffect(() => {
    api.getSessions().then(setSessions).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleTerminate = async (id: string) => {
    setTerminating(id);
    try {
      await api.terminateSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e) { console.error(e); }
    finally { setTerminating(null); }
  };

  const handleTerminateAll = async () => {
    setTerminating('all');
    try {
      const refreshToken = localStorage.getItem('sava_refresh_token') || undefined;
      await api.terminateAllSessions(refreshToken);
      // Keep only current session
      setSessions(prev => prev.slice(0, 1));
    } catch (e) { console.error(e); }
    finally { setTerminating(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={20} className="animate-spin text-zinc-500" />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-blue-400" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Активные сессии</span>
        </div>
        {sessions.length > 1 && (
          <button
            onClick={handleTerminateAll}
            disabled={terminating === 'all'}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            {terminating === 'all' ? <Loader2 size={12} className="animate-spin" /> : 'Завершить все'}
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-xs text-zinc-500 text-center py-4">Нет активных сессий</p>
      ) : (
        sessions.map((session, i) => (
          <motion.div
            key={session.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              {session.deviceInfo?.toLowerCase().includes('mobile') || session.deviceInfo?.toLowerCase().includes('android') || session.deviceInfo?.toLowerCase().includes('ios')
                ? <Smartphone size={16} className="text-blue-400" />
                : <Monitor size={16} className="text-blue-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{session.deviceInfo || 'Неизвестное устройство'}</p>
              <p className="text-xs text-zinc-500">
                {session.ipAddress || '—'} · {new Date(session.lastUsedAt).toLocaleDateString('ru-RU')}
              </p>
            </div>
            {i === 0 ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full flex-shrink-0">Текущая</span>
            ) : (
              <button
                onClick={() => handleTerminate(session.id)}
                disabled={!!terminating}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
              >
                {terminating === session.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            )}
          </motion.div>
        ))
      )}
    </div>
  );
}
