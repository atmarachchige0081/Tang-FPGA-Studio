import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props { children: ReactNode; label?: string; resetKey?: string; compact?: boolean }
interface State { error: Error | null; recovering: boolean }

/** Retry a failed view once; never reload the app or replay native workflows. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`FPGA Studio ${this.props.label ?? "workspace"} failure`, error, info.componentStack);
    if (this.attempts < 1) {
      this.attempts += 1;
      this.setState({ recovering: true });
      this.timer = setTimeout(() => this.setState({ error: null, recovering: false }), 800);
    }
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey) {
      clearTimeout(this.timer);
      this.attempts = 0;
      if (this.state.error) this.setState({ error: null, recovering: false });
    }
  }

  componentWillUnmount(): void { clearTimeout(this.timer); }

  private retry = () => {
    clearTimeout(this.timer);
    this.attempts = 0;
    this.setState({ error: null, recovering: false });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <section className={this.props.compact ? "component-recovery" : "crash-screen"} role="alert" aria-label={`${this.props.label ?? "Workspace"} recovery`}>
      <div className="crash-card"><AlertTriangle size={22}/><div>
        <h3>{this.props.label ?? "Workspace"} {this.state.recovering ? "is recovering…" : "needs attention"}</h3>
        {!this.props.compact && <p>Open editor buffers remain in memory. Running tools are not restarted.</p>}
        <details><summary>Error details</summary><pre>{this.state.error.message}</pre></details>
        <button className="secondary-button" disabled={this.state.recovering} onClick={this.retry}><RotateCcw size={16}/> Retry {this.props.label ?? "view"}</button>
      </div></div>
    </section>;
  }
}
