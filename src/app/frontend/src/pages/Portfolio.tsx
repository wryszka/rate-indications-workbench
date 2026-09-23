import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Portfolio as P } from '@/lib/api';
import { useMeta, Spin, Explainer } from '@/components/common';
import { GenieBox } from '@/components/genie-box';
import { pct, money, arrow, signClass } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'pos' }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'mt-1 text-2xl font-extrabold tnum ' + (tone === 'warn' ? 'text-warning' : tone === 'pos' ? 'text-success' : '')}>{value}</div>
    </CardContent></Card>
  );
}
const toneClass = (c: string) => (c === 'pos' ? 'text-success' : c === 'neg' ? 'text-warning' : 'text-muted-foreground');

export default function Portfolio() {
  const meta = useMeta()!;
  const nav = useNavigate();
  const [period, setPeriod] = useState(meta.periods[0] || 2027);
  const [p, setP] = useState<P | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); api.portfolio(period).then(d => { setP(d); setLoading(false); }); }, [period]);

  const inc = p?.segments.filter(s => s.baseline_indicated > 0.0005).length ?? 0;
  const dec = p?.segments.filter(s => s.baseline_indicated < -0.0005).length ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Approved baseline indication for every product × territory in the book.</p>
      </div>

      <Explainer>
        Each row is one segment (a product in a territory). The <em>baseline indication</em> is the approved rate
        change the current assumptions imply — positive means rates should rise, negative means they can fall. The{' '}
        <em>projected loss ratio</em> is the expected losses as a share of premium; the <em>selected rate</em> is what
        pricing has chosen to file, which may differ from the indication. Click a row to open it and work the assumptions.
      </Explainer>

      <div className="flex items-end gap-3">
        <div className="w-40">
          <Label className="mb-1 block">Indication period</Label>
          <Select value={String(period)} onValueChange={v => setPeriod(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meta.periods.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {loading || !p ? <Card><CardContent className="p-6"><Spin /> Loading…</CardContent></Card> : <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Kpi label="Portfolio indication" value={pct(p.portfolio_indicated)} tone={p.portfolio_indicated >= 0 ? 'warn' : 'pos'} />
          <Kpi label="On-level premium" value={money(p.total_premium, p.currency)} />
          <Kpi label="Segments" value={String(p.segments.length)} />
          <Kpi label="Need increase" value={String(inc)} tone="warn" />
          <Kpi label="Need decrease" value={String(dec)} tone="pos" />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Territory</TableHead>
                <TableHead className="text-right">Baseline indication</TableHead>
                <TableHead className="text-right">Projected LR</TableHead>
                <TableHead className="text-right">On-level premium</TableHead>
                <TableHead className="text-right">Selected rate</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {p.segments.map(s => (
                  <TableRow key={s.lob_code + s.territory_code} className="cursor-pointer"
                    onClick={() => nav(`/indications?lob=${s.lob_code}&territory=${s.territory_code}&period=${period}`)}>
                    <TableCell className="font-medium">{s.lob_label}</TableCell>
                    <TableCell>{s.territory_label}</TableCell>
                    <TableCell className={'text-right tnum font-semibold ' + toneClass(signClass(s.baseline_indicated))}>
                      {arrow(s.baseline_indicated)} {pct(s.baseline_indicated)}
                    </TableCell>
                    <TableCell className="text-right tnum">{pct(s.projected_loss_ratio, 1, false)}</TableCell>
                    <TableCell className="text-right tnum">{money(s.on_level_earned_premium, p.currency)}</TableCell>
                    <TableCell className="text-right tnum">{s.selected_rate_change != null ? pct(s.selected_rate_change) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {meta.genie_enabled && (
          <GenieBox suggestions={[
            'Which segments have the largest indicated rate increase?',
            'Which products need a rate decrease?',
          ]} />
        )}
      </>}
    </div>
  );
}
