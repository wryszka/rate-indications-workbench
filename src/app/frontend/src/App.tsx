import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Home as HomeIcon, LayoutGrid, TrendingUp, GitCompare, CheckCircle2, BookOpen, MessageCircleQuestion, Zap, RotateCcw } from 'lucide-react';
import { MetaProvider, useMeta, useAiMode } from './components/common';
import { api } from './lib/api';
import Home from './pages/Home';
import Portfolio from './pages/Portfolio';
import Indications from './pages/Indications';
import Scenarios from './pages/Scenarios';
import Review from './pages/Review';
import Learn from './pages/Learn';
import Genie from './pages/Genie';

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
  { to: '/indications', label: 'Rate Indications', icon: TrendingUp },
  { to: '/scenarios', label: 'Scenarios', icon: GitCompare },
  { to: '/review', label: 'Review & Approve', icon: CheckCircle2 },
  { to: '/learn', label: 'Learn', icon: BookOpen },
];

function AiToggle() {
  const { mode, setMode } = useAiMode();
  const live = mode === 'live';
  return (
    <button
      onClick={() => setMode(live ? 'cached' : 'live')}
      title="AI explanations: live calls Claude; cached serves a deterministic template"
      style={{
        display: 'flex', alignItems: 'center', gap: 7, width: '100%', cursor: 'pointer',
        background: live ? 'rgba(52,211,153,.14)' : 'rgba(245,158,11,.16)',
        color: live ? '#34d399' : '#fbbf24', border: '1px solid ' + (live ? 'rgba(52,211,153,.4)' : 'rgba(245,158,11,.4)'),
        borderRadius: 8, padding: '7px 10px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em',
      }}>
      <Zap size={13} /> AI: {live ? 'LIVE' : 'CACHED'}
      <span style={{ marginLeft: 'auto', fontWeight: 500, opacity: .8 }}>{live ? 'calling Claude' : 'tap for live'}</span>
    </button>
  );
}

function ResetButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    if (!window.confirm('Reset the demo? This removes scenarios created in the app and returns to the approved baselines.')) return;
    setBusy(true);
    try { const r = await api.reset(); setMsg(`reset — removed ${r.removed_scenarios}`); setTimeout(() => window.location.reload(), 700); }
    catch { setMsg('reset failed'); } finally { setBusy(false); }
  };
  return (
    <button onClick={run} disabled={busy} className="ghost"
      style={{ width: '100%', marginTop: 8, fontSize: 11.5, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}>
      <RotateCcw size={12} /> {msg ?? (busy ? 'Resetting…' : 'Reset demo')}
    </button>
  );
}

function Shell() {
  const meta = useMeta()!;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brickmark"><i /><i /><i /><i /></div>
          <div>
            <div className="bt">Bricksurance</div>
            <div className="bs">Rate Indications</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon className="ic" size={16} />{n.label}
            </NavLink>
          ))}
          {meta.genie_enabled && (
            <NavLink to="/ask" className={({ isActive }) => (isActive ? 'active' : '')}>
              <MessageCircleQuestion className="ic" size={16} />Ask the book
            </NavLink>
          )}
        </nav>
        <div className="side-foot">
          <AiToggle />
          <ResetButton />
          <div style={{ marginTop: 10 }}>Assumption setting &amp; review<br /><span className="pill">DEMO</span></div>
        </div>
      </aside>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/indications" element={<Indications />} />
        <Route path="/scenarios" element={<Scenarios />} />
        <Route path="/review" element={<Review />} />
        <Route path="/learn" element={<Learn />} />
        <Route path="/ask" element={<Genie />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <MetaProvider>
      <Shell />
    </MetaProvider>
  );
}
