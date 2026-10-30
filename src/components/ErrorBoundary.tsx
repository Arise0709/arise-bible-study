import { Component, type ReactNode } from 'react'
import { reportError } from '../lib/errorReport'

/** Catches a crash in one page so the rest of the app keeps working. Saved work lives in the database and is not affected. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'render')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>Your saved notes, studies, and sermons are safe. They are stored separately and were not affected.</p>
        <div className="row">
          <button className="btn primary" onClick={() => location.reload()}>
            Reload the page
          </button>
          <a className="btn" href="/bible">
            Go to the Bible
          </a>
        </div>
      </div>
    )
  }
}
