import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuthStore } from './stores/authStore';
import AuthPage from './pages/AuthPage';
import ChatPage from './pages/ChatPage';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const { token, user, checkAuth, isLoading } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <SavaLoader />
          <p className="text-zinc-500 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AnimatePresence mode="wait">
        {token && user ? (
          <ChatPage key="chat" />
        ) : (
          <AuthPage key="auth" />
        )}
      </AnimatePresence>
    </ErrorBoundary>
  );
}

function SavaLoader() {
  return (
    <div className="relative w-12 h-12">
      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
      <div
        className="absolute inset-1 rounded-full border-2 border-transparent border-t-blue-400 animate-spin"
        style={{ animationDuration: '0.8s', animationDirection: 'reverse' }}
      />
      <div
        className="absolute inset-2 rounded-full border-2 border-transparent border-t-blue-300 animate-spin"
        style={{ animationDuration: '0.6s' }}
      />
    </div>
  );
}
