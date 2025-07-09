import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<
  React.PropsWithChildren<{}>,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  componentDidUpdate(prevProps: React.PropsWithChildren<{}>) {
    // Reset error state if children prop changes (new content)
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex items-center justify-center">
          <div className="bg-white border-4 border-black p-8 shadow-[12px_12px_0px_0px_#000] text-center max-w-md">
            <h2 className="text-xl font-black text-black mb-4">OOPS! SOMETHING WENT WRONG</h2>
            <p className="font-bold text-gray-600 mb-4">
              Don't worry, this happens sometimes. Please refresh the page to try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-black text-white border-3 border-black px-4 py-2 font-black transition-all shadow-[3px_3px_0px_0px_#666] hover:shadow-[4px_4px_0px_0px_#00FF88] hover:bg-green-400 hover:translate-x-[-1px] hover:translate-y-[-1px]"
            >
              REFRESH PAGE
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;