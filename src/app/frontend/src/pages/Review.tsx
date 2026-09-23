import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, ClipboardCheck, FileText, Copy } from 'lucide-react';
import { api, ApiError, Scenario, AuditEvent, ScenarioDetail } from '@/lib/api';
import { useMeta, useAiMode, Spin, Explainer, AgentAction } from '@/components/common';
import { GenieBox } from '@/components/genie-box';
import { pct } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function Review() {
  const meta = useMeta()!;
  const roles = meta.approval_roles.map(r => r.role);
  const [scns, setScns] = useState<Scenario[]>([]);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [asRole, setAsRole] = useState<Record<string, string>>({});
  const [denied, setDenied] = useState<Record<string, string>>({});

  const reload = () => { setLoading(true); api.scenarios().then(d => { setScns(d.scenarios); setLoading(false); }); };
  useEffect(() => { reload(); }, []);

  const roleFor = (ind: number | null) => {
    if (ind == null) return '—';
    const a = Math.abs(ind);
    return meta.approval_roles.find(r => a >= r.min && a < r.max)?.role ?? meta.approval_roles.at(-1)?.role ?? '—';
  };
  const queue = scns.filter(s => s.status === 'SUBMITTED');
  const act = async (id: string, decision: 'approve' | 'reject') => {
    setDenied(d => ({ ...d, [id]: '' }));
    try {
      const role = asRole[id] ?? roleFor(scns.find(s => s.scenario_id === id)?.indicated_rate_change ?? 0);
      await api.review(id, decision, decision === 'approve' ? 'Basis reviewed and approved.' : 'Returned for revision.', role);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.body?.denied) setDenied(d => ({ ...d, [id]: e.message }));
      else setDenied(d => ({ ...d, [id]: 'Action failed.' }));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Review &amp; Approve</h1>
        <p className="mt-1 text-sm text-muted-foreground">Governed sign-off — routed by the size of the change, with a full append-only audit trail.</p>
      </div>

      <Explainer>
        Scenarios submitted for review appear here. Who must approve depends on the size of the indicated change
        (routing shown below). Approving or rejecting is itself an audited event. The audit trail for any scenario
        shows every action, who did it and when — and the recorded result carries the exact method version and data
        version, so any number can be reproduced later.
      </Explainer>

      <Card><CardContent className="space-y-2 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval routing</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {meta.approval_roles.map((r, i) => (
            <span key={i} className="rounded-md border bg-muted/40 px-2.5 py-1">|change| {(r.min * 100).toFixed(0)}–{r.max >= 90 ? '∞' : (r.max * 100).toFixed(0)}% → <span className="font-semibold">{r.role}</span></span>
          ))}
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review queue {queue.length > 0 && <Badge variant="warning">{queue.length}</Badge>}</div>
        {loading ? <Spin /> : queue.length === 0 ? <p className="text-sm text-muted-foreground">Nothing awaiting review. Submit a scenario from the Scenarios page.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Scenario</TableHead><TableHead>Segment</TableHead><TableHead className="text-right">Indicated</TableHead><TableHead>Requires</TableHead><TableHead>Approve as</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {queue.map(s => {
                const req = roleFor(s.indicated_rate_change);
                return (
                  <TableRow key={s.scenario_id} className="hover:bg-transparent">
                    <TableCell className="font-medium">{s.scenario_name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.lob_code} · {s.territory_code} · {s.indication_period}</TableCell>
                    <TableCell className="text-right tnum font-semibold">{s.indicated_rate_change != null ? pct(s.indicated_rate_change) : '—'}</TableCell>
                    <TableCell><Badge variant="outline">{req}</Badge></TableCell>
                    <TableCell>
                      <Select value={asRole[s.scenario_id] ?? req} onValueChange={v => setAsRole(r => ({ ...r, [s.scenario_id]: v }))}>
                        <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
                        <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><div className="flex gap-2">
                      <Button size="sm" onClick={() => act(s.scenario_id, 'approve')}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => act(s.scenario_id, 'reject')}>Reject</Button>
                    </div></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {Object.entries(denied).filter(([, m]) => m).map(([id, m]) => (
          <div key={id} className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {m}
          </div>
        ))}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit trail</div>
        <div className="w-full max-w-xl">
          <Label className="mb-1 block">Scenario</Label>
          <Select value={openAudit ?? ''} onValueChange={v => setOpenAudit(v || null)}>
            <SelectTrigger><SelectValue placeholder="Select a scenario…" /></SelectTrigger>
            <SelectContent>{scns.map(s => <SelectItem key={s.scenario_id} value={s.scenario_id}>{s.scenario_name} — {s.lob_code}/{s.territory_code} ({s.status})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {openAudit && <AuditTrail id={openAudit} />}
      </CardContent></Card>

      {meta.genie_enabled && (
        <GenieBox suggestions={[
          'Which submitted scenarios have the largest indicated change?',
          'Show the approved baseline indication by product',
        ]} />
      )}
    </div>
  );
}

function AuditTrail({ id }: { id: string }) {
  const { mode } = useAiMode();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  useEffect(() => { api.audit(id).then(d => setEvents(d.events)); api.scenario(id).then(setDetail); }, [id]);
  if (!events) return <Spin />;
  return (
    <div className="space-y-3">
      {detail?.result && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AgentAction title="Peer-review before sign-off"
            subtitle="Flags anything worth a second look — trend, credibility, method, indicated-vs-selected."
            label="Review this scenario" icon={<ClipboardCheck className="h-4 w-4" />}
            run={() => api.agentReview(id, mode)} />
          <AgentAction title="Draft the committee paper"
            subtitle="A plain-English memo from the recorded result — narrates the numbers, invents nothing."
            label="Draft committee paper" icon={<FileText className="h-4 w-4" />}
            run={() => api.agentCommitteePaper(id, mode)}
            extra={r => (
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(r.answer)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
            )} />
        </div>
      )}
      {detail?.result && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span><span className="font-semibold text-success">Reproducible.</span> Recorded result: indicated <span className="font-semibold">{pct(detail.result.indicated_rate_change)}</span> · calc version <span className="font-semibold">{detail.result.calc_version}</span> · data version <span className="font-semibold">{detail.result.experience_version}</span>
            {detail.premium_settings && <> · on-level <span className="font-semibold">{detail.premium_settings.method === 'parallelogram_fixed_term' ? 'earning-aware' : 'annual-index'}</span></>} · by {detail.result.calculated_by}</span>
          <a href={api.exportUrl(id)} className="ml-auto shrink-0"><Button size="sm" variant="outline">Export CSV</Button></a>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
        <TableBody>
          {events.map((e, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell className="text-xs text-muted-foreground">{String(e.log_ts).replace('T', ' ').slice(0, 19)}</TableCell>
              <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
              <TableCell className="text-muted-foreground">{e.actor}</TableCell>
              <TableCell className="text-muted-foreground">{e.from_status && e.to_status ? `${e.from_status} → ${e.to_status}` : e.to_status || ''}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{e.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
