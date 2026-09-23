import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, TrendingUp, GitCompare, CheckCircle2, BookOpen, Info } from 'lucide-react';
import { api, Portfolio } from '@/lib/api';
import { useMeta, Spin } from '@/components/common';
import { disclaimerLong } from '@/lib/brand';
import { pct, money } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'pos' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={'mt-1 text-2xl font-extrabold tnum ' + (tone === 'warn' ? 'text-warning' : tone === 'pos' ? 'text-success' : '')}>{value}</div>
      </CardContent>
    </Card>
  );
}

const CARDS = [
  { to: '/portfolio', icon: LayoutGrid, t: 'Portfolio', d: "Every segment's indication and selected rate; drill into one." },
  { to: '/indications', icon: TrendingUp, t: 'Rate Indications', d: 'Set assumptions and see the indication move, live and explained.' },
  { to: '/scenarios', icon: GitCompare, t: 'Scenarios', d: 'Save, clone and compare alternative assumption sets.' },
  { to: '/review', icon: CheckCircle2, t: 'Review & Approve', d: 'Draft → Submitted → Approved, with the full audit trail.' },
  { to: '/learn', icon: BookOpen, t: 'Learn', d: 'How each step maps to a governed platform object.' },
];

export default function Home() {
  const meta = useMeta()!;
  const [p, setP] = useState<Portfolio | null>(null);
  useEffect(() => { api.portfolio(meta.periods[0] || 2027).then(setP).catch(() => {}); }, [meta]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rate Indications &amp; Assumption Setting</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meta.entity_name} · European commercial P&amp;C · a governed workflow from experience to an approved rate</p>
      </div>

      {p && (
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-5 text-sm">
            <span className="font-semibold">Why this matters. </span>
            On this book (~{money(p.total_premium, p.currency)} on-level premium), the portfolio indicates{' '}
            <span className="font-semibold">{pct(p.portfolio_indicated)}</span> — about{' '}
            <span className="font-semibold">{money(Math.abs(p.portfolio_indicated * p.total_premium), p.currency)}</span>{' '}
            of rate movement under review. Repricing slowly, by spreadsheet and email, leaves underpriced segments
            unaddressed between cycles and is hard to audit. This decides it in one governed place — and layers on
            your existing tools.
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-500/30 bg-warning/[0.06]">
        <CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span><span className="font-semibold text-foreground">About this demo. </span>{disclaimerLong(meta.entity_name).replace('About this demo. ', '')}</span>
        </CardContent>
      </Card>

      {p ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi label="Portfolio indication" value={pct(p.portfolio_indicated)} tone={p.portfolio_indicated >= 0 ? 'warn' : 'pos'} />
          <Kpi label="On-level premium" value={money(p.total_premium, p.currency)} />
          <Kpi label="Segments" value={String(p.segments.length)} />
          <Kpi label="Need increase" value={String(p.segments.filter(s => s.baseline_indicated > 0.0005).length)} />
          <Kpi label="Need decrease" value={String(p.segments.filter(s => s.baseline_indicated < -0.0005).length)} />
        </div>
      ) : <Card><CardContent className="p-6"><Spin /> Loading portfolio…</CardContent></Card>}

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The workflow</div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review the current indication for a product and territory, inspect the assumptions behind it, change one
          and watch the indication and its decomposition update, compare scenarios, then record a selected rate and
          take it through review and approval — every calculation recorded and auditable.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map(c => (
            <Link key={c.to} to={c.to}>
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 font-semibold"><c.icon className="h-4 w-4" /> {c.t}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{c.d}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
