import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  /** Shown in the fallback so the user knows which part failed. */
  area: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a failure in one panel from taking down the editor. The diagram model
 * lives in the store, not in the component tree, so recovering is just a
 * matter of remounting - the user's work is still there.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail available for bug reports without spamming the console.
    (window as unknown as Record<string, unknown>).__lastEditorError = {
      error,
      info,
    };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel-error" role="alert">
          <span className="eyebrow">{this.props.area}</span>
          <h3>This panel stopped updating</h3>
          <p>{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
