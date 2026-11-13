import { Component } from 'react';

// Catches a crash inside one panel (a dashboard tab) so the rest of the screen -
// the sidebar, the open POS cart - stays as it was (2026-11 audit, M111). Before,
// the one app-wide boundary replaced everything with "Something went wrong".
export default class PanelBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    // Visible in the browser console and to any error reporter hooked there.
    console.error('Panel crashed', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 p-6 rounded-xl border border-gray-700 bg-surface text-center">
        <p className="text-fg font-bold mb-1">This section could not be shown.</p>
        <p className="text-fg/70 text-sm mb-4">{String(this.state.error?.message || this.state.error)}</p>
        <div className="flex gap-2 justify-center">
          <button type="button" onClick={() => this.setState({ error: null })}
            className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-sm">Try again</button>
          <button type="button" onClick={() => window.location.reload()}
            className="border border-gray-600 text-fg px-4 py-2 rounded-lg font-bold text-sm">Reload the app</button>
        </div>
      </div>
    );
  }
}
