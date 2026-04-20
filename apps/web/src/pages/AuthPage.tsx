import { useState, FormEvent, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { useLang } from '../lib/i18n';
import { Eye, EyeOff, ArrowRight, UserPlus, LogIn, Mic, MicOff } from 'lucide-react';
import { api } from '../lib/api';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [registrationPassword, setRegistrationPassword] = useState('');
  const [bio, setBio] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requireRegPassword, setRequireRegPassword] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('checking');
  const { login, register } = useAuthStore();
  const { t } = useLang();

  useEffect(() => {
    api.getRegistrationSettings()
      .then((data: { requireRegistrationPassword: boolean }) => setRequireRegPassword(data.requireRegistrationPassword))
      .catch(() => setRequireRegPassword(false));
    
    // Check microphone permission status
    checkMicPermission();
  }, []);

  const checkMicPermission = async () => {
    try {
      if (!navigator.permissions) {
        // Если permissions API недоступен, проверяем mediaDevices
        if (navigator.mediaDevices) {
          setMicPermission('prompt');
        } else {
          setMicPermission('denied');
        }
        return;
      }
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setMicPermission(result.state as 'prompt' | 'granted' | 'denied');
      result.addEventListener('change', () => {
        setMicPermission(result.state as 'prompt' | 'granted' | 'denied');
      });
    } catch {
      setMicPermission('prompt');
    }
  };

  const requestMicAccess = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Доступ к микрофону не поддерживается.\n\nУбедитесь, что используете HTTPS соединение.');
        setMicPermission('denied');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
    } catch {
      setMicPermission('denied');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await register(username, displayName || username, password, bio, registrationPassword || undefined);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full flex items-center justify-center relative overflow-hidden bg-surface"
    >
      {/* Анимированный фон */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-20">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-600/30 to-blue-800/30 blur-[120px] animate-pulse" />
        </div>
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-700/10 rounded-full blur-[100px]" />
      </div>

      {/* Карточка авторизации */}
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="glass-strong rounded-3xl p-8 shadow-2xl shadow-blue-500/5">
          {/* Заголовок */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ rotate: -180, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ duration: 0.6, type: 'spring', bounce: 0.4 }}
              className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30"
            >
              <span className="text-4xl font-bold text-white">S</span>
            </motion.div>
            <h1 className="text-2xl font-bold gradient-text mt-4">SAVA</h1>
            <p className="text-zinc-500 text-sm mt-1">{t('modernMessengerShort')}</p>
          </div>

          {/* Переключатель Вход/Регистрация */}
          <div className="flex rounded-xl bg-white/5 p-1 mb-6">
            <button
              onClick={() => { setIsLogin(true); setError(''); setPassword(''); }}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                isLogin
                  ? 'bg-gradient-to-r from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-500/25'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              aria-pressed={isLogin}
            >
              <LogIn size={16} />
              {t('login')}
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); setPassword(''); }}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                !isLogin
                  ? 'bg-gradient-to-r from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-500/25'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              aria-pressed={!isLogin}
            >
              <UserPlus size={16} />
              {t('register')}
            </button>
          </div>

          {/* Ошибка */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                role="alert"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Форма */}
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                Username {!isLogin && <span className="text-zinc-600">{t('latinOnly')}</span>}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="username"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                required
                autoFocus
                autoComplete="off"
              />
            </div>

            <AnimatePresence>
              {!isLogin && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                    {t('displayNameLabel')}
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('displayNamePlaceholder')}
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                {t('password')} {!isLogin && <span className="text-zinc-600">(мин. 8 символов, буквы + цифры)</span>}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder')}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all pr-12"
                  required
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {!isLogin && (
                <>
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">{t('aboutMe')}</label>
                    <input
                      type="text"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder={t('bioPlaceholder')}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                    />
                  </motion.div>

                  {/* Registration Password Field — показывается только если сервер требует */}
                  {requireRegPassword && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                        Пароль для регистрации
                      </label>
                      <input
                        type="password"
                        value={registrationPassword}
                        onChange={(e) => setRegistrationPassword(e.target.value)}
                        placeholder="Введите пароль для регистрации"
                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25 transition-all"
                      />
                    </motion.div>
                  )}
                </>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              disabled={isSubmitting}
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 text-white font-medium shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isLogin ? t('loginBtn') : t('createAccount')}
                  <ArrowRight size={18} />
                </>
              )}
            </motion.button>
          </form>

        </div>

        {/* Индикатор статуса микрофона */}
        <div className="mt-4 flex items-center justify-center gap-2">
          {micPermission === 'checking' ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="w-3 h-3 border border-zinc-400 border-t-zinc-600 rounded-full animate-spin" />
              <span>Проверка микрофона...</span>
            </div>
          ) : micPermission === 'granted' ? (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <Mic size={14} />
              <span>Микрофон разрешён</span>
            </div>
          ) : micPermission === 'denied' ? (
            <button
              onClick={requestMicAccess}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
            >
              <MicOff size={14} />
              <span>Микрофон заблокирован (нажмите для исправления)</span>
            </button>
          ) : (
            <button
              onClick={requestMicAccess}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <Mic size={14} />
              <span>Разрешить микрофон</span>
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
