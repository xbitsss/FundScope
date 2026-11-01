import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FundScope render failed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-crash-state" role="alert">
          <div className="app-crash-card">
            <span className="eyebrow">FUND SCOPE</span>
            <h1>FundScope ran into a problem.</h1>
            <p>Your saved data is still on this device. Reload the app to try again.</p>
            <button className="button primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
