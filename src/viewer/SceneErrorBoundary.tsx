import { Component, type ReactNode } from 'react';

/** Shows nothing in place of a scene that can't render, such as without WebGL, and reports it. */
export class SceneErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
