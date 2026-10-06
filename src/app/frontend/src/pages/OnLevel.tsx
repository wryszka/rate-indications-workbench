import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, AlertTriangle, Send, RotateCcw } from 'lucide-react';
import { api, ApiError, Result, ScenarioDetail, RateContext, PremiumSettings, PremiumSummary, RateEventRow } from '@/lib/api';
import { useMeta, useAiMode, Spin, Explainer, SourceChip } from '@/components/common';
import { GenieBox } from '@/components/genie-box';
import { pct, money, toDisplay, fromDisplay } from '@/lib/format';
import { disclaimerLong } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const PARA = 'parallelogram_fixed_term';
const LEGACY = 'legacy_annual_index';
const methodLabel = (m: string) => (m === PARA ? 'Earning-aware (parallelogram)' : 'Legacy annual-index');

function Kpi({ label, value, busy, sub, tone }: { label: string; value: string; busy?: boolean; sub?: string; tone?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 flex items-center gap-2 text-2xl font-extrabold tnum', tone)}>{value}{busy && <Spin />}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

// Advise-only Q&A over the earning-aware on-level detail.
function OnLevelQA({ lob, territory, period, mode }: { lob: string; territory: string; period: number; mode: string }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<{ answer: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    if (!q.trim() || busy) return;
    setBusy(true);
    try { const a = await api.agentInterrogate(lob, territory, period, q, mode); setR({ answer: a.answer, source: a.source }); }
    catch { setR({ answer: 'Could not answer that one.', source: 'fallback' }); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.03] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
        <Sparkles className="h-3.5 w-3.5" /> AI assistant · Ask about the on-level</div>
      <div className="flex gap-2">
        <Input value={q} placeholder="e.g. why is the factor above 1 this year?" className="h-8"
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(); }} />
        <Button size="sm" variant="outline" onClick={ask} disabled={busy || !q.trim()}><Send className="h-4 w-4" /> Ask {busy && <Spin />}</Button>
      </div>
      {r && (
        <div className="mt-2 flex items-start gap-2 text-sm">
          <SourceChip source={r.source} />
          <p className="text-muted-foreground">{r.answer}</p>
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Advise-only — explains the figures, doesn't compute them.</p>
    </div>
  );
}

export default function OnLevel() {
  const meta = useMeta()!;
  const { mode: aiMode } = useAiMode();
  const [sp, setSp] = useSearchParams();
  const lob = sp.get('lob') || 'GENERAL_LIABILITY';
  const territory = sp.get('territory') || 'DE';
  const period = Number(sp.get('period')) || meta.periods[0] || 2027;
  const setSeg = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n); };

  const [base, setBase] = useState<ScenarioDetail | null>(null);
  const [rateCtx, setRateCtx] = useState<RateContext | null>(null);
  const [method, setMethod] = useState<string>(LEGACY);
  const [events, setEvents] = useState<RateEventRow[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [summary, setSummary] = useState<PremiumSummary | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setBase(null); setResult(null); setError(null);
    api.segment(lob, territory, period).then(v => {
      setBase(v.baseline); setRateCtx(v.rate_context);
      setMethod(v.baseline.premium_settings?.method || v.rate_context.on_level_method || LEGACY);
      setEvents(v.rate_context.events.map(e => ({ ...e })));
    });
  }, [lob, territory, period]);

  const buildSettings = (): PremiumSettings | undefined => {
    if (!rateCtx) return undefined;
    const orig = new Map(rateCtx.events.map(e => [e.event_id || e.effective_date, e]));
    const overrides = events
      .filter(e => e.effective_date)
      .filter(e => { const o = orig.get(e.event_id || e.effective_date); return !o || o.rate_change_pct !== e.rate_change_pct || o.effective_date !== e.effective_date; })
      .map(e => ({ effective_date: e.effective_date as string, change: e.rate_change_pct, event_id: e.event_id || undefined }));
    return {
      method, reference_rate_date: rateCtx.reference_rate_date, baseline_effective_date: rateCtx.baseline_effective_date,
      baseline_rate_index: rateCtx.baseline_rate_index, policy_term_days: rateCtx.policy_term_days,
      rate_history_version: rateCtx.default_settings.rate_history_version, event_overrides: overrides,
    };
  };

  useEffect(() => {
    if (!base || !rateCtx) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const mySeq = ++seq.current;
      abort.current?.abort();
      const ac = new AbortController(); abort.current = ac;
      setBusy(true);
      // The on-level restatement depends on the method + rate history, not on the downstream
      // indication assumptions — so we run the baseline assumptions and read the premium summary.
      api.preview(lob, territory, period, base.assumptions, buildSettings(), ac.signal)
        .then(p => { if (mySeq === seq.current) { setResult(p.result); setSummary(p.premium_summary); setError(null); } })
        .catch(e => { if (mySeq === seq.current && e.name !== 'AbortError') { setError(e instanceof ApiError ? e.message : 'Preview failed'); } })
        .finally(() => { if (mySeq === seq.current) setBusy(false); });
    }, 300);
    return () => timer.current && clearTimeout(timer.current);
  }, [method, events, base, rateCtx]);

  if (!base || !rateCtx) return <div><h1 className="text-2xl font-bold tracking-tight">On-level earned premium</h1><Card className="mt-4"><CardContent className="p-6"><Spin /> Loading segment…</CardContent></Card></div>;

  const cur = result ?? base.result!;
  const histEP = summary?.total_earned_premium ?? cur.total_earned_premium ?? 0;
  const olEP = summary?.total_on_level_earned_premium ?? cur.on_level_earned_premium;
  const uplift = olEP - histEP;
  const rawLR = summary?.raw_reported_loss_ratio ?? cur.raw_reported_loss_ratio;
  const olLR = summary?.on_level_reported_loss_ratio ?? cur.on_level_reported_loss_ratio;
  const overallFactor = summary?.overall_on_level_factor ?? cur.overall_on_level_factor ?? 1;
  const prodLabel = meta.products.find(p => p.code === lob)?.label ?? lob;
  const terrLabel = meta.territories.find(t => t.code === territory)?.label ?? territory;
  const dirty = method !== (base.premium_settings?.method || LEGACY) || (buildSettings()?.event_overrides.length ?? 0) > 0;

  const editEvent = (i: number, field: 'rate_change_pct' | 'effective_date', v: string) =>
    setEvents(es => es.map((e, j) => j === i ? { ...e, [field]: field === 'rate_change_pct' ? fromDisplay(v, 'pct') : v } : e));
  const resetAll = () => { setMethod(base.premium_settings?.method || LEGACY); setEvents(rateCtx.events.map(e => ({ ...e }))); };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">On-level earned premium</h1>
        <p className="mt-1 text-sm text-muted-foreground">{prodLabel} · {terrLabel} · {period} — restate historic premium to today's price level</p>
      </div>

      <Explainer>
        Premium collected in past years was charged at older rates. Before you can compare years fairly — or judge
        rate adequacy — you restate that premium to the reference rate level ({rateCtx.reference_rate_date}). The
        multiplier that does it is the <em>on-level factor</em>. Choose the method below and watch each year's premium,
        the factor, and the loss ratios restate. This is a fair-comparison restatement — it never changes live prices.
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
        <div className="w-28"><Label className="mb-1 block">Period</Label>
          <Select value={String(period)} onValueChange={v => setSeg('period', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.periods.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="w-64"><Label className="mb-1 block">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{rateCtx.methods.map(m => <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={resetAll} disabled={!dirty}><RotateCcw className="h-4 w-4" /> Reset</Button>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="font-medium">{methodLabel(method)}</span>{' '}
        {method === LEGACY ? '— an annual-index simplification (what a spreadsheet does).' : `— earning-aware, ${rateCtx.policy_term_days}-day policies, straight-line earning.`}
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Historical earned premium" value={money(histEP, meta.currency)} />
        <Kpi label="On-level earned premium" value={money(olEP, meta.currency)} busy={busy} />
        <Kpi label="Premium uplift" value={money(uplift, meta.currency)} tone={uplift >= 0 ? 'text-success' : 'text-warning'} />
        <Kpi label="Overall on-level factor" value={overallFactor.toFixed(4)} sub={`× ${methodLabel(method).toLowerCase()}`} />
      </div>

      <div className="rounded-md border p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Reported loss ratios (same losses, two denominators)</div>
        <div className="mt-2 flex items-center gap-6">
          <div><div className="text-xs text-muted-foreground">Raw (÷ historical EP)</div><div className="text-xl font-bold tnum">{pct(rawLR, 1, false)}</div></div>
          <div className="text-muted-foreground">→</div>
          <div><div className="text-xs text-muted-foreground">On-level (÷ on-level EP)</div><div className="text-xl font-bold tnum text-primary">{pct(olLR, 1, false)}</div></div>
        </div>
      </div>

      <Card><CardContent className="p-0">
        <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On-level by accident year</div>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-right">AY</TableHead><TableHead className="text-right">Earned premium</TableHead>
            <TableHead className="text-right">Avg earned idx</TableHead><TableHead className="text-right">Ref idx</TableHead>
            <TableHead className="text-right">On-level ×</TableHead><TableHead className="text-right">On-level EP</TableHead>
            <TableHead className="text-right">Raw LR</TableHead><TableHead className="text-right">On-lvl LR</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(cur.detail_years ?? []).map(d => (
              <TableRow key={d.accident_year}>
                <TableCell className="text-right tnum">{d.accident_year}</TableCell>
                <TableCell className="text-right tnum">{money(d.earned_premium, meta.currency)}</TableCell>
                <TableCell className="text-right tnum">{d.average_earned_index != null ? d.average_earned_index.toFixed(4) : '—'}</TableCell>
                <TableCell className="text-right tnum">{d.reference_index != null ? d.reference_index.toFixed(4) : '—'}</TableCell>
                <TableCell className="text-right tnum">{d.on_level_factor != null ? d.on_level_factor.toFixed(4) : '—'}</TableCell>
                <TableCell className="text-right tnum">{money(d.on_level_earned_premium, meta.currency)}</TableCell>
                <TableCell className="text-right tnum text-muted-foreground">{pct(d.raw_reported_lr, 1, false)}</TableCell>
                <TableCell className="text-right tnum text-primary">{pct(d.on_level_reported_lr, 1, false)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent></Card>

      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Rate history (scenario-local)</div>
          <span className="text-[11px] text-muted-foreground">dates assumed Jan 1 — synthetic</span>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Effective date</TableHead><TableHead className="text-right">Rate change</TableHead><TableHead className="text-right">Index</TableHead></TableRow></TableHeader>
          <TableBody>
            {events.map((e, i) => (
              <TableRow key={e.event_id || i} className="hover:bg-transparent">
                <TableCell><Input type="date" value={e.effective_date ?? ''} onChange={ev => editEvent(i, 'effective_date', ev.target.value)} className="h-8 w-36" /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Input inputMode="decimal" value={toDisplay('', e.rate_change_pct, 'pct')} onChange={ev => editEvent(i, 'rate_change_pct', ev.target.value)} className="h-8 w-20 text-right tnum" />
                    <span className="w-3 text-xs text-muted-foreground">%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right tnum text-muted-foreground">{e.rate_level_index?.toFixed(4) ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-1 text-xs text-muted-foreground">Edits are scenario-local — they never change the master history or the approved baseline.</p>
      </div>

      <OnLevelQA lob={lob} territory={territory} period={period} mode={aiMode} />

      {meta.genie_enabled && (
        <GenieBox placeholder={`Ask about ${prodLabel} in ${terrLabel}…`}
          suggestions={[`Show earned premium and rate index for ${prodLabel} in ${terrLabel}`]} />
      )}

      <p className="pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">About this demo. </span>
        {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </p>
    </div>
  );
}
