import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RotateCcw, Save, Target, ShieldCheck } from 'lucide-react';
import { api, TrendView, TrendFit, TrendYear } from '@/lib/api';
import { useMeta, Spin, Explainer } from '@/components/common';
import { GenieBox } from '@/components/genie-box';
import { pct, pts, money, fromDisplay } from '@/lib/format';
import { disclaimerLong } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Window = 'all' | 'last5';

// Actual points + the fitted exponential line, so the trend is visible, not just a number.
function TrendChart({ years, metric, fit, fmt }: {
  years: TrendYear[]; metric: 'frequency' | 'severity'; fit: TrendFit; fmt: (v: number) => string;
}) {
  const pts = years.filter(y => y[metric] != null).map(y => ({ x: y.accident_year, y: y[metric] as number }));
  if (pts.length < 2) return null;
  const W = 420, H = 150, P = 28;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const fitted = fit ? pts.map(p => Math.exp(fit.intercept + fit.slope * p.x)) : [];
  const lo = Math.min(...ys, ...fitted) * 0.97, hi = Math.max(...ys, ...fitted) * 1.03;
  const sx = (x: number) => P + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - 2 * P);
  const sy = (y: number) => H - P + 6 - ((y - lo) / (hi - lo)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`${metric} by accident year with fitted trend`}>
      {fit && <polyline fill="none" strokeWidth={2} strokeDasharray="5 4" className="stroke-primary/60"
        points={pts.map((p, i) => `${sx(p.x)},${sy(fitted[i])}`).join(' ')} />}
      <polyline fill="none" strokeWidth={1.5} className="stroke-foreground/30" points={pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
      {pts.map(p => (
        <g key={p.x}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={3.5} className="fill-primary" />
          <text x={sx(p.x)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{p.x}</text>
        </g>
      ))}
      <text x={P} y={12} className="fill-muted-foreground text-[10px]">{fmt(hi)}</text>
      <text x={P} y={H - P + 4} className="fill-muted-foreground text-[10px]">{fmt(lo)}</text>
    </svg>
  );
}

function FitCard({ title, metric, view, win, selected, fmt, what }: {
  title: string; metric: 'frequency' | 'severity'; view: TrendView; win: Window; selected: number;
  fmt: (v: number) => string; what: string;
}) {
  const fit = view.fits[win][metric];
  const gap = fit ? (selected - fit.trend) * 100 : 0;
  return (
    <Card><CardContent className="space-y-2 p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground">{what}</div>
      </div>
      <TrendChart years={view.years.filter(y => y.accident_year >= view.fits[win].years[0])} metric={metric} fit={fit} fmt={fmt} />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[11px] text-muted-foreground">Fitted (history)</div>
          <div className="text-lg font-bold tnum">{fit ? pct(fit.trend, 1) : '—'}</div></div>
        <div><div className="text-[11px] text-muted-foreground">Fit quality (R²)</div>
          <div className="text-lg font-bold tnum">{fit ? fit.r2.toFixed(2) : '—'}</div></div>
        <div><div className="text-[11px] text-muted-foreground">Selected</div>
          <div className="text-lg font-bold tnum text-primary">{pct(selected, 1)}</div></div>
      </div>
      {fit && <p className="text-xs text-muted-foreground">
        Selected is <span className="font-medium text-foreground">{pts(gap)}</span> vs the fitted history —
        {Math.abs(gap) < 0.3 ? ' in line with the data.' : gap > 0 ? ' more prudent than the data alone.' : ' lighter than the data — worth a reason.'}
      </p>}
    </CardContent></Card>
  );
}

export default function LossTrend() {
  const meta = useMeta()!;
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const lob = sp.get('lob') || 'GENERAL_LIABILITY';
  const territory = sp.get('territory') || 'DE';
  const period = Number(sp.get('period')) || meta.periods[0] || 2027;
  const setSeg = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n); };

  const [view, setView] = useState<TrendView | null>(null);
  const [baseInd, setBaseInd] = useState<number | null>(null);
  const [win, setWin] = useState<Window>('all');
  const [freq, setFreq] = useState('');
  const [sev, setSev] = useState('');
  const [ind, setInd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('Loss trend selection');
  const timer = useRef<any>(null);

  useEffect(() => {
    setView(null); setInd(null);
    Promise.all([api.trend(lob, territory, period), api.segment(lob, territory, period)]).then(([t, s]) => {
      setView(t); setBaseInd(s.baseline.result?.indicated_rate_change ?? null);
      setFreq((t.selected.frequency_trend * 100).toFixed(2)); setSev((t.selected.severity_trend * 100).toFixed(2));
    });
  }, [lob, territory, period]);

  const selF = fromDisplay(freq, 'pct'), selS = fromDisplay(sev, 'pct');

  // What the selected trend does to the rate indication (same engine, live).
  useEffect(() => {
    if (!view || Number.isNaN(selF) || Number.isNaN(selS)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(true);
      api.preview(lob, territory, period, { ...view.baseline_assumptions, frequency_trend: selF, severity_trend: selS })
        .then(p => setInd(p.result.indicated_rate_change)).finally(() => setBusy(false));
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [freq, sev, view]);

  if (!view) return <div><h1 className="text-2xl font-bold tracking-tight">Loss trend</h1><Card className="mt-4"><CardContent className="p-6"><Spin /> Loading segment…</CardContent></Card></div>;

  const prodLabel = meta.products.find(p => p.code === lob)?.label ?? lob;
  const terrLabel = meta.territories.find(t => t.code === territory)?.label ?? territory;
  const fw = view.fits[win];
  const approved = view.selected;
  const dirty = Math.abs(selF - approved.frequency_trend) > 1e-9 || Math.abs(selS - approved.severity_trend) > 1e-9;
  const combined = (1 + selF) * (1 + selS) - 1;
  const useFitted = () => {
    if (fw.frequency) setFreq((fw.frequency.trend * 100).toFixed(2));
    if (fw.severity) setSev((fw.severity.trend * 100).toFixed(2));
  };
  const reset = () => { setFreq((approved.frequency_trend * 100).toFixed(2)); setSev((approved.severity_trend * 100).toFixed(2)); };
  const doSave = async () => {
    const { scenario_id } = await api.createScenario({ name, lob, territory, period });
    await api.saveAssumptions(scenario_id, { ...view.baseline_assumptions, frequency_trend: selF, severity_trend: selS });
    setSaveOpen(false);
    navigate(`/scenarios?open=${scenario_id}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Loss trend</h1>
        <p className="mt-1 text-sm text-muted-foreground">{prodLabel} · {terrLabel} — how fast claims are changing, and the trend we carry into {period}</p>
      </div>

      <Explainer>
        Claim costs move over time: how <em>often</em> claims happen (frequency = claims ÷ exposure) and how <em>much</em> each
        one costs (severity = developed ultimate loss ÷ claims). Each dot is one accident year; the dashed line is the
        exponential trend fitted to that history (the same fit as Excel's LOGEST). The actuary then <em>selects</em> the trend to
        carry forward — the data informs it, judgement decides it. The selection feeds straight into the rate indication,
        and saving it records who chose what, and when.
      </Explainer>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52"><Label className="mb-1 block">Product</Label>
          <Select value={lob} onValueChange={v => setSeg('lob', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.products.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="w-44"><Label className="mb-1 block">Territory</Label>
          <Select value={territory} onValueChange={v => setSeg('territory', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.territories.map(t => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="w-52"><Label className="mb-1 block">Fit over</Label>
          <Select value={win} onValueChange={v => setWin(v as Window)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years ({view.fits.all.years.join('–')})</SelectItem>
              <SelectItem value="last5">Last 5 years ({view.fits.last5.years.join('–')})</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FitCard title="Frequency trend" metric="frequency" view={view} win={win} selected={selF}
          fmt={v => v.toFixed(4)} what="claims per unit of exposure" />
        <FitCard title="Severity trend" metric="severity" view={view} win={win} selected={selS}
          fmt={v => money(v, meta.currency)} what="developed cost per claim" />
      </div>

      {/* The selection — what gets carried into the indication */}
      <Card className="border-primary/30"><CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><Target className="h-4 w-4" /> Your selected trend</div>
        <div className="flex flex-wrap items-end gap-4">
          <div><Label className="mb-1 block">Frequency trend</Label>
            <div className="flex items-center gap-1"><Input inputMode="decimal" value={freq} onChange={e => setFreq(e.target.value)} className="h-9 w-24 text-right tnum" /><span className="text-xs text-muted-foreground">% / yr</span></div></div>
          <div><Label className="mb-1 block">Severity trend</Label>
            <div className="flex items-center gap-1"><Input inputMode="decimal" value={sev} onChange={e => setSev(e.target.value)} className="h-9 w-24 text-right tnum" /><span className="text-xs text-muted-foreground">% / yr</span></div></div>
          <div className="text-sm"><div className="text-[11px] text-muted-foreground">Combined loss trend</div><div className="text-lg font-bold tnum">{pct(combined, 2)}</div></div>
          <div className="flex-1" />
          <Button variant="outline" onClick={useFitted}>Use fitted ({win === 'all' ? 'all years' : 'last 5'})</Button>
          <Button variant="outline" onClick={reset} disabled={!dirty}><RotateCcw className="h-4 w-4" /> Approved</Button>
          <Button onClick={() => setSaveOpen(true)} disabled={!dirty}><Save className="h-4 w-4" /> Save as scenario</Button>
        </div>
        <div className="grid grid-cols-3 gap-4 rounded-md border bg-muted/30 p-3 text-center">
          <div><div className="text-[11px] text-muted-foreground">Rate indication — approved trend</div><div className="text-xl font-bold tnum">{pct(baseInd)}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Rate indication — your trend</div>
            <div className={cn('flex items-center justify-center gap-2 text-xl font-bold tnum', (ind ?? 0) >= 0 ? 'text-warning' : 'text-success')}>{pct(ind)}{busy && <Spin />}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Change</div><div className="text-xl font-bold tnum">{ind != null && baseInd != null ? pts((ind - baseInd) * 100) : '—'}</div></div>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing changes until you save. Saving creates a draft scenario carrying this trend; calculating it records the result,
          and every step — who selected the trend, when, and the indication it produced — lands in the append-only audit trail.</p>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The history behind the fit</div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-right">AY</TableHead><TableHead className="text-right">Exposure</TableHead>
              <TableHead className="text-right">Claims</TableHead><TableHead className="text-right">Reported</TableHead>
              <TableHead className="text-right">LDF</TableHead><TableHead className="text-right">Developed ultimate</TableHead>
              <TableHead className="text-right">Frequency</TableHead><TableHead className="text-right">Severity</TableHead>
              <TableHead className="text-right">Pure premium</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {view.years.map(y => (
                <TableRow key={y.accident_year} className={cn(y.accident_year < fw.years[0] && 'opacity-50')}>
                  <TableCell className="text-right tnum">{y.accident_year}</TableCell>
                  <TableCell className="text-right tnum">{Math.round(y.exposure).toLocaleString()}</TableCell>
                  <TableCell className="text-right tnum">{y.claim_count}</TableCell>
                  <TableCell className="text-right tnum">{money(y.reported_incurred, meta.currency)}</TableCell>
                  <TableCell className="text-right tnum">{y.ldf_to_ultimate.toFixed(3)}</TableCell>
                  <TableCell className="text-right tnum">{money(y.developed_ultimate, meta.currency)}</TableCell>
                  <TableCell className="text-right tnum">{y.frequency?.toFixed(4) ?? '—'}</TableCell>
                  <TableCell className="text-right tnum">{money(y.severity, meta.currency)}</TableCell>
                  <TableCell className="text-right tnum">{money(y.pure_premium, meta.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground">Developed ultimate = reported × LDF. Greyed years sit outside the chosen fit window.
          Pure premium trend (fitted, {win === 'all' ? 'all years' : 'last 5'}): {fw.pure_premium ? pct(fw.pure_premium.trend, 1) : '—'}.</p>
      </CardContent></Card>

      {meta.genie_enabled && (
        <GenieBox placeholder={`Ask about claims in ${prodLabel} · ${terrLabel}…`}
          suggestions={[`Show claim count and exposure by accident year for ${prodLabel} in ${terrLabel}`]} />
      )}

      <p className="pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">About this demo. </span>
        {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </p>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save trend selection as a scenario</DialogTitle>
            <DialogDescription>A new DRAFT scenario for {prodLabel} · {terrLabel} · {period} with frequency {pct(selF, 2)} and severity {pct(selS, 2)}; all other assumptions stay at the approved baseline. Calculating it records the result and an audit event.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label>Scenario name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={doSave}>Create scenario</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
