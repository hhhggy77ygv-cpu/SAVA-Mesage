import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="h-full flex items-center justify-center bg-surface p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Что-то пошло не так</h2>
            <p className="text-sm text-zinc-400">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу.
            </p>
            {this.state.error && (
              <pre className="text-xs text-zinc-600 bg-surface-secondary rounded-xl p-3 text-left overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm transition-colors"
              >
                <RefreshCw size={14} />
                Попробовать снова
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-xl bg-surface-secondary hover:bg-surface-hover text-zinc-300 text-sm transition-colors"
              >
                Перезагрузить страницу
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
