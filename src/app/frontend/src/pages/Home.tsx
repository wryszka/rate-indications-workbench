import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, TrendingUp, GitCompare, CheckCircle2, BookOpen } from 'lucide-react';
import { api, Portfolio } from '../lib/api';
import { useMeta, Spin } from '../components/common';
import { disclaimerLong } from '../lib/brand';
import { pct, money } from '../lib/format';

export default function Home() {
  const meta = useMeta()!;
  const [p, setP] = useState<Portfolio | null>(null);
  useEffect(() => { api.portfolio(meta.periods[0] || 2027).then(setP).catch(() => {}); }, [meta]);

  return (
    <main className="main">
      <div className="hero">
        <h2>Rate Indications &amp; Assumption Setting</h2>
        <div className="meta">{meta.entity_name} · European commercial P&amp;C · a governed workflow from experience to an approved rate</div>
      </div>

      {p && (
        <div className="banner">
          <strong>Why this matters.</strong> On this book (~{money(p.total_premium, p.currency)} on-level premium),
          the portfolio indicates <strong>{pct(p.portfolio_indicated)}</strong> — about{' '}
          <strong>{money(Math.abs(p.portfolio_indicated * p.total_premium), p.currency)}</strong> of rate movement
          under review. Repricing slowly, by spreadsheet and email, leaves underpriced segments unaddressed between
          cycles and is hard to audit. This decides it in one governed place — and layers on your existing tools.
        </div>
      )}

      <div className="banner">
        <strong>About this demo.</strong> {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </div>

      {p ? (
        <div className="tiles">
          <div className="tile"><div className="k">Portfolio indication</div><div className={'v ' + (p.portfolio_indicated >= 0 ? 'warn' : 'pos')}>{pct(p.portfolio_indicated)}</div></div>
          <div className="tile"><div className="k">On-level premium</div><div className="v">{money(p.total_premium, p.currency)}</div></div>
          <div className="tile"><div className="k">Segments</div><div className="v">{p.segments.length}</div></div>
          <div className="tile"><div className="k">Need increase</div><div className="v">{p.segments.filter(s => s.baseline_indicated > 0.0005).length}</div></div>
          <div className="tile"><div className="k">Need decrease</div><div className="v">{p.segments.filter(s => s.baseline_indicated < -0.0005).length}</div></div>
        </div>
      ) : <div className="card"><Spin /> Loading portfolio…</div>}

      <div className="card">
        <div className="eyebrow">The workflow</div>
        <p style={{ marginTop: 0, color: 'var(--slate2)', fontSize: 14 }}>
          Review the current indication for a product and territory, inspect the assumptions behind it,
          change one and watch the indication and its decomposition update, compare scenarios, then record
          a selected rate and take it through review and approval — every calculation recorded and auditable.
        </p>
        <div className="navcards" style={{ marginTop: 12 }}>
          <Link className="navcard" to="/portfolio"><div className="t"><LayoutGrid size={17} /> Portfolio</div><div className="d">Every segment's indication and selected rate; drill into one.</div></Link>
          <Link className="navcard" to="/indications"><div className="t"><TrendingUp size={17} /> Rate Indications</div><div className="d">Set assumptions and see the indication move, live and explained.</div></Link>
          <Link className="navcard" to="/scenarios"><div className="t"><GitCompare size={17} /> Scenarios</div><div className="d">Save, clone and compare alternative assumption sets.</div></Link>
          <Link className="navcard" to="/review"><div className="t"><CheckCircle2 size={17} /> Review &amp; Approve</div><div className="d">Draft → Submitted → Approved, with the full audit trail.</div></Link>
          <Link className="navcard" to="/learn"><div className="t"><BookOpen size={17} /> Learn</div><div className="d">How each step maps to a governed platform object.</div></Link>
        </div>
      </div>
    </main>
  );
}
