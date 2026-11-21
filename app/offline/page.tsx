export const dynamic = 'force-static';

export default function Offline() {
  return (
    <div className="page page-plain" style={{ textAlign: 'center', paddingTop: '30vh' }}>
      <div style={{ fontSize: 48 }} aria-hidden>📡</div>
      <h1 style={{ fontSize: 22 }}>You’re offline</h1>
      <p className="muted">Open a screen you’ve visited before to see cached data. New expenses are queued and sync when you’re back online.</p>
      <a className="btn" href="/" style={{ marginTop: 16 }}>Try again</a>
    </div>
  );
}
