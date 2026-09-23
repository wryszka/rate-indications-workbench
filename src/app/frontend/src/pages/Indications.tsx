import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, RotateCcw, Save, AlertTriangle } from 'lucide-react';
import { api, ApiError, Result, Step, ScenarioDetail, RateContext, PremiumSettings, PremiumSummary, RateEventRow } from '@/lib/api';
import { useMeta, useAiMode, Spin, Explainer, Waterfall } from '@/components/common';
import { pct, pts, money, toDisplay, fromDisplay, unitSuffix, signClass, arrow } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const PARA = 'parallelogram_fixed_term';
const LEGACY = 'legacy_annual_index';
const methodLabel = (m: string) => (m === PARA ? 'Earning-aware (parallelogram)' : 'Legacy annual-index');
const toneClass = (c: string) => (c === 'pos' ? 'text-success' : c === 'neg' ? 'text-warning' : 'text-muted-foreground');

function Kpi({ label, value, tone, busy, sub }: { label: string; value: string; tone?: string; busy?: boolean; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 flex items-center gap-2 text-2xl font-extrabold tnum', tone)}>{value}{busy && <Spin />}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

export default function Indications() {
  const meta = useMeta()!;
  const { mode: aiMode } = useAiMode();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const lob = sp.get('lob') || 'GENERAL_LIABILITY';
  const territory = sp.get('territory') || 'DE';
  const period = Number(sp.get('period')) || meta.periods[0] || 2027;
  const setSeg = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n); };

  const [base, setBase] = useState<ScenarioDetail | null>(null);
  const [rateCtx, setRateCtx] = useState<RateContext | null>(null);
  const [assum, setAssum] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<string>(LEGACY);
  const [events, setEvents] = useState<RateEventRow[]>([]);   // editable, scenario-local rate history
  const [preview, setPreview] = useState<{ result: Result; decomposition: Step[]; summary?: PremiumSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('Actuarial Recommended');
  const [explain, setExplain] = useState<{ answer: string; source: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const timer = useRef<any>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setBase(null); setPreview(null); setExplain(null); setError(null);
    api.segment(lob, territory, period).then(v => {
      setBase(v.baseline); setRateCtx(v.rate_context);
      setAssum({ ...v.baseline.assumptions });
      setMethod(v.baseline.premium_settings?.method || v.rate_context.on_level_method || LEGACY);
      setEvents(v.rate_context.events.map(e => ({ ...e })));
    });
  }, [lob, territory, period]);

  // build the scenario-local premium settings from method + edited rate history
  const buildSettings = (): PremiumSettings | undefined => {
    if (!rateCtx) return undefined;
    const orig = new Map(rateCtx.events.map(e => [e.event_id || e.effective_date, e]));
    const overrides = events
      .filter(e => e.effective_date)
      .filter(e => {
        const o = orig.get(e.event_id || e.effective_date);
        return !o || o.rate_change_pct !== e.rate_change_pct || o.effective_date !== e.effective_date;
      })
      .map(e => ({ effective_date: e.effective_date as string, change: e.rate_change_pct, event_id: e.event_id || undefined }));
    return {
      method,
      reference_rate_date: rateCtx.reference_rate_date,
      baseline_effective_date: rateCtx.baseline_effective_date,
      baseline_rate_index: rateCtx.baseline_rate_index,
      policy_term_days: rateCtx.policy_term_days,
      rate_history_version: rateCtx.default_settings.rate_history_version,
      event_overrides: overrides,
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
      api.preview(lob, territory, period, assum, buildSettings(), ac.signal)
        .then(p => { if (mySeq === seq.current) { setPreview({ result: p.result, decomposition: p.decomposition, summary: p.premium_summary }); setError(null); } })
        .catch(e => { if (mySeq === seq.current && e.name !== 'AbortError') { setError(e instanceof ApiError ? e.message : 'Preview failed'); setPreview(null); } })
        .finally(() => { if (mySeq === seq.current) setBusy(false); });
    }, 350);
    return () => timer.current && clearTimeout(timer.current);
  }, [assum, method, events, base, rateCtx]);

  if (!base || !rateCtx) return <div><h1 className="text-2xl font-bold tracking-tight">Rate Indications</h1><Card className="mt-4"><CardContent className="p-6"><Spin /> Loading segment…</CardContent></Card></div>;

  const baseRes = base.result!;
  const cur = preview?.result ?? baseRes;
  const summary = preview?.summary;
  const baseMethod = base.premium_settings?.method || LEGACY;
  const psDirty = method !== baseMethod || (buildSettings()?.event_overrides.length ?? 0) > 0;
  const dirty = JSON.stringify(assum) !== JSON.stringify(base.assumptions) || psDirty;
  const changePts = (cur.indicated_rate_change - baseRes.indicated_rate_change) * 100;
  const groups = ['Loss', 'Method', 'Provision'];
  const metaByName = base.assumption_meta;
  const prodLabel = meta.products.find(p => p.code === lob)?.label ?? lob;
  const terrLabel = meta.territories.find(t => t.code === territory)?.label ?? territory;

  const uplift = summary ? summary.total_on_level_earned_premium - summary.total_earned_premium : (cur.on_level_earned_premium - (cur.total_earned_premium ?? 0));
  const rawLR = summary?.raw_reported_loss_ratio ?? cur.raw_reported_loss_ratio;
  const olLR = summary?.on_level_reported_loss_ratio ?? cur.on_level_reported_loss_ratio;
  const overallFactor = summary?.overall_on_level_factor ?? cur.overall_on_level_factor ?? 1;
  const histEP = summary?.total_earned_premium ?? cur.total_earned_premium ?? 0;
  const olEP = summary?.total_on_level_earned_premium ?? cur.on_level_earned_premium;

  const editEvent = (i: number, field: 'rate_change_pct' | 'effective_date', v: string) =>
    setEvents(es => es.map((e, j) => j === i ? { ...e, [field]: field === 'rate_change_pct' ? fromDisplay(v, 'pct') : v } : e));

  const resetAll = () => { setAssum({ ...base.assumptions }); setMethod(baseMethod); setEvents(rateCtx.events.map(e => ({ ...e }))); };

  const doExplain = () => {
    setExplaining(true);
    api.explain({ payload: {
      segment: `${base.scenario.lob_code} / ${base.scenario.territory_code}`, period,
      result: cur, baseline_indicated: baseRes.indicated_rate_change, decomposition: preview?.decomposition ?? [],
    }, mode: aiMode }).then(r => setExplain({ answer: r.answer, source: r.source })).finally(() => setExplaining(false));
  };
  const doSave = async () => {
    const { scenario_id } = await api.createScenario({ name, lob, territory, period });
    await api.saveAssumptions(scenario_id, assum);
    const ps = buildSettings(); if (ps) await api.savePremiumSettings(scenario_id, ps);
    setSaveOpen(false);
    nav(`/scenarios?open=${scenario_id}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{prodLabel} · {terrLabel} · {period}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Loss-ratio rate indication {dirty ? '· unsaved preview — not recorded until saved & calculated' : '· showing the approved baseline'}</p>
      </div>

      <Explainer>
        We take this segment's earned premium and losses, restate old premium at today's rate level (on-level premium),
        develop losses to their expected final cost, trend them to {period}, then compare the projected loss ratio with
        the loss ratio the price can permit after expenses, commission, reinsurance and profit. The gap is the indicated
        rate change. The on-level panel below chooses how premium is restated; everything else updates instantly and the
        waterfall shows what moved the indication.
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
        <div className="flex-1" />
        <Button variant="outline" onClick={resetAll} disabled={!dirty}><RotateCcw className="h-4 w-4" /> Reset to baseline</Button>
        <Button onClick={() => setSaveOpen(true)} disabled={!dirty}><Save className="h-4 w-4" /> Save as scenario</Button>
      </div>

      {/* ---- On-level premium panel (before the downstream assumptions) ---- */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On-level earned premium</div>
              <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
                Restates historic earned premium to the reference rate level ({rateCtx.reference_rate_date}), so premium and
                losses are comparable. <span className="font-medium">{methodLabel(method)}</span>{' '}
                {method === LEGACY ? '— an annual-index simplification (what a spreadsheet does).' : `— earning-aware, ${rateCtx.policy_term_days}-day policies, straight-line earning.`}
              </p>
            </div>
            <div className="w-64"><Label className="mb-1 block">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{rateCtx.methods.map(m => <SelectItem key={m} value={m}>{methodLabel(m)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Historical earned premium" value={money(histEP, meta.currency)} />
            <Kpi label="On-level earned premium" value={money(olEP, meta.currency)} busy={busy} />
            <Kpi label="Premium uplift" value={money(uplift, meta.currency)} tone={toneClass(signClass(uplift))} />
            <Kpi label="Overall on-level factor" value={overallFactor.toFixed(4)} sub={`× ${methodLabel(method).toLowerCase()}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Reported loss ratios (same losses, two denominators)</div>
              <div className="mt-2 flex items-center gap-6">
                <div><div className="text-xs text-muted-foreground">Raw (÷ historical EP)</div><div className="text-xl font-bold tnum">{pct(rawLR, 1, false)}</div></div>
                <div className="text-muted-foreground">→</div>
                <div><div className="text-xs text-muted-foreground">On-level (÷ on-level EP)</div><div className="text-xl font-bold tnum text-primary">{pct(olLR, 1, false)}</div></div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Distinct from the trended <em>projected</em> loss ratio below (which also develops &amp; trends the losses).</p>
            </div>

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
                      <TableCell>
                        <Input type="date" value={e.effective_date ?? ''} onChange={ev => editEvent(i, 'effective_date', ev.target.value)} className="h-8 w-36" />
                      </TableCell>
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
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi label="Current rate level" value={(baseRes.current_rate_level ?? 1).toFixed(3)} />
        <Kpi label="Projected loss ratio" value={pct(cur.projected_loss_ratio, 1, false)} />
        <Kpi label="Baseline indication" value={pct(baseRes.indicated_rate_change)} />
        <Kpi label="Scenario indication" value={pct(cur.indicated_rate_change)} tone={cur.indicated_rate_change >= 0 ? 'text-warning' : 'text-success'} busy={busy} />
        <Kpi label="Change vs baseline" value={`${arrow(changePts / 100)} ${pts(changePts)}`} tone={toneClass(signClass(changePts / 100))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-0">
            <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assumptions</div>
            <Table>
              <TableHeader><TableRow><TableHead>Assumption</TableHead><TableHead className="text-right">Baseline</TableHead><TableHead className="text-right">Scenario</TableHead></TableRow></TableHeader>
              <TableBody>
                {groups.map(g => {
                  const names = base.assumption_order.filter(n => metaByName[n].group === g);
                  if (!names.length) return null;
                  return [
                    <TableRow key={g + 'h'} className="hover:bg-transparent"><TableCell colSpan={3} className="py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g}</TableCell></TableRow>,
                    ...names.map(n => {
                      const m = metaByName[n]; const bv = base.assumptions[n];
                      const changed = Math.abs((assum[n] ?? 0) - bv) > 1e-9;
                      return (
                        <TableRow key={n} className="hover:bg-transparent">
                          <TableCell>{m.label}</TableCell>
                          <TableCell className="text-right tnum text-muted-foreground">{toDisplay(n, bv, m.unit)}{unitSuffix(m.unit)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Input inputMode="decimal" value={toDisplay(n, assum[n] ?? bv, m.unit)}
                                onChange={e => setAssum(a => ({ ...a, [n]: fromDisplay(e.target.value, m.unit) }))}
                                className={cn('h-8 w-24 text-right tnum', changed && 'border-primary font-bold')} />
                              <span className="w-4 text-xs text-muted-foreground">{unitSuffix(m.unit)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ];
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why the indication moved</div>
            <p className="text-sm text-muted-foreground">
              From <span className="font-semibold text-foreground">{pct(baseRes.indicated_rate_change)}</span> (baseline) to{' '}
              <span className={cn('font-semibold', cur.indicated_rate_change >= 0 ? 'text-warning' : 'text-success')}>{pct(cur.indicated_rate_change)}</span>{' '}
              — contributions sum exactly to the {pts(changePts)} move. A ◆ step is the premium (on-level) basis.
            </p>
            <Waterfall steps={preview?.decomposition ?? []} />
            <div className="border-t pt-3">
              <Button variant="outline" onClick={doExplain} disabled={explaining}><Sparkles className="h-4 w-4" /> Explain indication {explaining && <Spin />}</Button>
              {explain && (
                <div className="mt-3 rounded-md border bg-muted/40 p-3 text-sm">
                  <Badge variant={explain.source === 'live' ? 'success' : 'secondary'} className="mb-2">{explain.source}</Badge>
                  <p>{explain.answer}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="px-4 py-0">
          <Accordion type="single" collapsible>
            <AccordionItem value="detail" className="border-0">
              <AccordionTrigger>Experience detail — how each accident year builds up</AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-right">AY</TableHead><TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Avg earned idx</TableHead><TableHead className="text-right">Ref idx</TableHead><TableHead className="text-right">On-level ×</TableHead>
                    <TableHead className="text-right">On-level EP</TableHead><TableHead className="text-right">Reported</TableHead>
                    <TableHead className="text-right">Raw LR</TableHead><TableHead className="text-right">On-lvl LR</TableHead>
                    <TableHead className="text-right">LDF</TableHead><TableHead className="text-right">Trend ×</TableHead>
                    <TableHead className="text-right">Trended ult.</TableHead><TableHead className="text-right">Trended÷OLEP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(cur.detail_years ?? baseRes.detail_years ?? []).map(d => (
                      <TableRow key={d.accident_year}>
                        <TableCell className="text-right tnum">{d.accident_year}</TableCell>
                        <TableCell className="text-right tnum">{money(d.earned_premium, meta.currency)}</TableCell>
                        <TableCell className="text-right tnum">{d.average_earned_index != null ? d.average_earned_index.toFixed(4) : '—'}</TableCell>
                        <TableCell className="text-right tnum">{d.reference_index != null ? d.reference_index.toFixed(4) : '—'}</TableCell>
                        <TableCell className="text-right tnum">{d.on_level_factor != null ? d.on_level_factor.toFixed(4) : '—'}</TableCell>
                        <TableCell className="text-right tnum">{money(d.on_level_earned_premium, meta.currency)}</TableCell>
                        <TableCell className="text-right tnum">{money(d.reported_incurred, meta.currency)}</TableCell>
                        <TableCell className="text-right tnum text-muted-foreground">{pct(d.raw_reported_lr, 1, false)}</TableCell>
                        <TableCell className="text-right tnum text-primary">{pct(d.on_level_reported_lr, 1, false)}</TableCell>
                        <TableCell className="text-right tnum">{d.effective_ldf.toFixed(3)}</TableCell>
                        <TableCell className="text-right tnum">{d.trend_factor.toFixed(3)}</TableCell>
                        <TableCell className="text-right tnum">{money(d.trended_ultimate, meta.currency)}</TableCell>
                        <TableCell className="text-right tnum">{pct(d.loss_ratio, 1, false)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Raw LR = reported ÷ earned; On-lvl LR = reported ÷ on-level EP (same losses). The last column is the
                  trended-ultimate ÷ on-level-EP ratio that feeds the indication — not a raw loss ratio.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as scenario</DialogTitle>
            <DialogDescription>A new DRAFT scenario for {prodLabel} · {terrLabel} · {period}, including the on-level method &amp; rate history. Calculating it records the result and an audit event.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Scenario name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button onClick={doSave}>Create scenario</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
