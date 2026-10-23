import { Component, type ErrorInfo, type ReactNode } from 'react'
import { markHandled, reportError } from '../lib/selfMonitor'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    markHandled(error)
    reportError(error, { source: 'react', component_stack: (info.componentStack ?? '').trim().slice(0, 1000) })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="center">
        <div className="card padded" role="alert" style={{ maxWidth: 480 }}>
          <h1>Something went wrong</h1>
          <p className="mu">The page hit an unexpected problem. Reloading usually fixes it.</p>
          <button className="btn pri" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
