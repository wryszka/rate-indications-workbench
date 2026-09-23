import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Scenario, ScenarioDetail } from '@/lib/api';
import { useMeta, Spin, Explainer } from '@/components/common';
import { pct, toDisplay, fromDisplay, unitSuffix } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

type BV = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
const STATUS_VARIANT: Record<string, BV> = {
  APPROVED: 'success', DRAFT: 'secondary', SUBMITTED: 'warning', REVIEWED: 'warning', REJECTED: 'destructive', SUPERSEDED: 'outline',
};

export default function Scenarios() {
  useMeta();
  const [sp] = useSearchParams();
  const [scns, setScns] = useState<Scenario[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(sp.get('open'));
  const [cmp, setCmp] = useState<{ scenarios: ScenarioDetail[]; assumption_order: string[]; assumption_meta: any } | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = () => { setLoading(true); api.scenarios().then(d => { setScns(d.scenarios); setLoading(false); }); };
  useEffect(() => { reload(); }, []);
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 3 ? [...s, id] : s);
  const doCompare = () => api.compare(sel).then(setCmp);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scenarios</h1>
        <p className="mt-1 text-sm text-muted-foreground">Saved assumption sets across the book — clone, compare, calculate and take through review.</p>
      </div>

      <Explainer>
        A scenario is a named set of assumptions for one product × territory × period, with a workflow status. The{' '}
        <em>Approved Baseline</em> is the current approved basis. Tick two or three to compare them side by side, or
        open a draft to edit its assumptions, recalculate (which records the result), set a selected rate and submit it.
      </Explainer>

      {sel.length >= 2 && (
        <Card className="border-primary/30"><CardContent className="flex items-center gap-3 p-4 text-sm">
          <span>{sel.length} scenarios selected.</span>
          <Button size="sm" onClick={doCompare}>Compare side by side</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSel([]); setCmp(null); }}>Clear</Button>
        </CardContent></Card>
      )}

      {cmp && <Compare cmp={cmp} />}

      {loading ? <Card><CardContent className="p-6"><Spin /> Loading…</CardContent></Card> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-8"></TableHead><TableHead>Scenario</TableHead><TableHead>Product · Territory</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Indicated</TableHead><TableHead className="text-right">Selected</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {scns.map(s => (
                <TableRow key={s.scenario_id} className="hover:bg-transparent">
                  <TableCell><input type="checkbox" className="h-4 w-4 accent-primary" checked={sel.includes(s.scenario_id)} onChange={() => toggle(s.scenario_id)} /></TableCell>
                  <TableCell className="font-medium">{s.scenario_name}{s.is_baseline && <Badge variant="success" className="ml-2">baseline</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{s.lob_code} · {s.territory_code} · {s.indication_period}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[s.status] || 'secondary'}>{s.status}</Badge></TableCell>
                  <TableCell className="text-right tnum">{s.indicated_rate_change != null ? pct(s.indicated_rate_change) : '—'}</TableCell>
                  <TableCell className="text-right tnum">{s.selected_rate_change != null ? pct(s.selected_rate_change) : '—'}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => setOpen(s.scenario_id)}>Open</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {open && <ScenarioEditor id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function Compare({ cmp }: { cmp: { scenarios: ScenarioDetail[]; assumption_order: string[]; assumption_meta: any } }) {
  const cols = cmp.scenarios; const meta = cmp.assumption_meta;
  return (
    <Card><CardContent className="p-0">
      <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scenario comparison</div>
      <Table>
        <TableHeader><TableRow><TableHead>Metric</TableHead>{cols.map(c => <TableHead key={c.scenario.scenario_id} className="text-right">{c.scenario.scenario_name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          <TableRow className="hover:bg-transparent"><TableCell colSpan={cols.length + 1} className="py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Result</TableCell></TableRow>
          <TableRow className="hover:bg-transparent"><TableCell>Projected loss ratio</TableCell>{cols.map(c => <TableCell key={c.scenario.scenario_id} className="text-right tnum">{c.result ? pct(c.result.projected_loss_ratio, 1, false) : '—'}</TableCell>)}</TableRow>
          <TableRow className="hover:bg-transparent"><TableCell>Indicated rate change</TableCell>{cols.map(c => <TableCell key={c.scenario.scenario_id} className="text-right tnum font-bold">{c.result ? pct(c.result.indicated_rate_change) : '—'}</TableCell>)}</TableRow>
          <TableRow className="hover:bg-transparent"><TableCell>Selected rate change</TableCell>{cols.map(c => <TableCell key={c.scenario.scenario_id} className="text-right tnum">{c.scenario.selected_rate_change != null ? pct(c.scenario.selected_rate_change) : '—'}</TableCell>)}</TableRow>
          <TableRow className="hover:bg-transparent"><TableCell colSpan={cols.length + 1} className="py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Assumptions</TableCell></TableRow>
          {cmp.assumption_order.map(n => {
            const m = meta[n]; const vals = cols.map(c => c.assumptions[n]);
            const differ = new Set(vals.map(v => v?.toFixed(6))).size > 1;
            return (
              <TableRow key={n} className={differ ? 'bg-warning/10 hover:bg-warning/10' : 'hover:bg-transparent'}>
                <TableCell>{m.label}{differ && <Badge variant="warning" className="ml-2">differs</Badge>}</TableCell>
                {cols.map((c, i) => <TableCell key={c.scenario.scenario_id} className="text-right tnum">{toDisplay(n, vals[i], m.unit)}{unitSuffix(m.unit)}</TableCell>)}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function ScenarioEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<ScenarioDetail | null>(null);
  const [assum, setAssum] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState('');
  const [comment, setComment] = useState('');
  const load = () => api.scenario(id).then(v => { setD(v); setAssum({ ...v.assumptions }); setSel(v.scenario.selected_rate_change != null ? String((v.scenario.selected_rate_change * 100).toFixed(1)) : ''); });
  useEffect(() => { load(); }, [id]);
  if (!d) return <Card><CardContent className="p-6"><Spin /> Loading scenario…</CardContent></Card>;

  const editable = d.scenario.status === 'DRAFT' && !d.scenario.is_baseline;
  const recalc = async () => { setBusy('calc'); await api.saveAssumptions(id, assum); await api.calculate(id); await load(); onChanged(); setBusy(''); };
  const saveSel = async () => { setBusy('sel'); await api.selectRate(id, fromDisplay(sel, 'pct'), comment); await load(); onChanged(); setBusy(''); };
  const submit = async () => { setBusy('submit'); await api.submit(id); await load(); onChanged(); setBusy(''); };

  return (
    <Card className="border-primary/30"><CardContent className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.scenario.scenario_name} — {d.scenario.lob_code} · {d.scenario.territory_code} · {d.scenario.indication_period}</div>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={STATUS_VARIANT[d.scenario.status] || 'secondary'}>{d.scenario.status}</Badge>
        {d.result && <span className="text-sm text-muted-foreground">Indicated <span className="font-semibold text-foreground">{pct(d.result.indicated_rate_change)}</span> · projected LR {pct(d.result.projected_loss_ratio, 1, false)}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Table>
            <TableHeader><TableRow><TableHead>Assumption</TableHead><TableHead className="text-right">Baseline</TableHead><TableHead className="text-right">{editable ? 'Scenario (editable)' : 'Scenario'}</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.assumption_order.map(n => {
                const m = d.assumption_meta[n];
                return (
                  <TableRow key={n} className="hover:bg-transparent">
                    <TableCell>{m.label}</TableCell>
                    <TableCell className="text-right tnum text-muted-foreground">{toDisplay(n, d.baseline[n], m.unit)}{unitSuffix(m.unit)}</TableCell>
                    <TableCell className="text-right tnum">
                      {editable
                        ? <Input value={toDisplay(n, assum[n], m.unit)} onChange={e => setAssum(a => ({ ...a, [n]: fromDisplay(e.target.value, m.unit) }))} className="ml-auto h-8 w-24 text-right tnum" />
                        : <>{toDisplay(n, assum[n], m.unit)}{unitSuffix(m.unit)}</>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {editable && <Button onClick={recalc} disabled={busy === 'calc'} className="mt-3">Recalculate &amp; record {busy === 'calc' && <Spin />}</Button>}
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Selected rate</div>
          <p className="text-sm text-muted-foreground">The indication is the actuary's answer; the selected rate is what management chooses to file — capture why they differ.</p>
          <Label>Selected rate change (%)</Label>
          <Input value={sel} onChange={e => setSel(e.target.value)} className="w-32 tnum" />
          <Label>Commentary</Label>
          <textarea className="min-h-[60px] w-full rounded-md border border-input bg-background p-2 text-sm" value={comment} onChange={e => setComment(e.target.value)}
            placeholder="e.g. Severity trend raised on latest claims; selected rate moderated for competitive reasons." />
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={saveSel} disabled={busy === 'sel'}>Save selection {busy === 'sel' && <Spin />}</Button>
            {d.scenario.status === 'DRAFT' && <Button onClick={submit} disabled={busy === 'submit'}>Submit for review {busy === 'submit' && <Spin />}</Button>}
          </div>
        </div>
      </div>
    </CardContent></Card>
  );
}
