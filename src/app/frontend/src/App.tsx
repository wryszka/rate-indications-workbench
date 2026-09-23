import { useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Home as HomeIcon, LayoutGrid, TrendingUp, GitCompare, CheckCircle2, BookOpen,
  MessageCircleQuestion, Zap, RotateCcw, Menu, X,
} from 'lucide-react';
import { MetaProvider, useMeta, useAiMode } from '@/components/common';
import { ThemeProvider, ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import Home from '@/pages/Home';
import Portfolio from '@/pages/Portfolio';
import Indications from '@/pages/Indications';
import Scenarios from '@/pages/Scenarios';
import Review from '@/pages/Review';
import Learn from '@/pages/Learn';
import Genie from '@/pages/Genie';

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
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors',
        live ? 'border-success/40 bg-success/10 text-success' : 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      <Zap className="h-3.5 w-3.5" /> AI: {live ? 'LIVE' : 'CACHED'}
      <span className="ml-auto font-normal opacity-80">{live ? 'calling Claude' : 'tap for live'}</span>
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
    <Button variant="ghost" size="sm" onClick={run} disabled={busy} className="mt-2 w-full justify-center gap-2 text-xs">
      <RotateCcw className="h-3 w-3" /> {msg ?? (busy ? 'Resetting…' : 'Reset demo')}
    </Button>
  );
}

function Brickmark() {
  return (
    <div className="grid h-8 w-8 shrink-0 grid-cols-2 grid-rows-2 gap-[3px] rounded-md bg-primary/10 p-1">
      <i className="rounded-[2px] bg-chart-2" /><i className="rounded-[2px] bg-chart-3" />
      <i className="rounded-[2px] bg-chart-3" /><i className="rounded-[2px] bg-chart-2" />
    </div>
  );
}

function Sidebar({ onNav }: { onNav?: () => void }) {
  const meta = useMeta()!;
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center gap-3 px-4 py-4">
        <Brickmark />
        <div>
          <div className="text-sm font-extrabold tracking-tight">{meta.entity_name?.split(' ')[0] || 'Bricksurance'}</div>
          <div className="text-[11px] text-muted-foreground">Rate Indications</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-auto px-3 py-2">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={onNav}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}>
            <n.icon className="h-4 w-4" />{n.label}
          </NavLink>
        ))}
        {meta.genie_enabled && (
          <NavLink to="/ask" onClick={onNav}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}>
            <MessageCircleQuestion className="h-4 w-4" />Ask the book
          </NavLink>
        )}
      </nav>
      <div className="border-t p-3">
        <AiToggle />
        <ResetButton />
        <div className="mt-3 text-[11px] text-muted-foreground">
          Assumption setting &amp; review
          <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground">DEMO</span>
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  '/': 'Home', '/portfolio': 'Portfolio', '/indications': 'Rate Indications',
  '/scenarios': 'Scenarios', '/review': 'Review & Approve', '/learn': 'Learn', '/ask': 'Ask the book',
};

function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r lg:block"><Sidebar /></aside>
      {/* mobile off-canvas */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r shadow-lg"><Sidebar onNav={() => setOpen(false)} /></aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(o => !o)} aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="text-sm font-semibold">{TITLES[loc.pathname] ?? 'Rate Indications'}</div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/indications" element={<Indications />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/review" element={<Review />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/ask" element={<Genie />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MetaProvider>
        <Shell />
      </MetaProvider>
    </ThemeProvider>
  );
}
