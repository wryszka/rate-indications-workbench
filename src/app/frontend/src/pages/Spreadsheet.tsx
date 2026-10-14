import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileSpreadsheet, Send, Download, Upload, Database, CheckCircle2, XCircle, MinusCircle, ShieldCheck,
  ExternalLink, ArrowRight, History,
} from 'lucide-react';
import { api, ApiError, Handoff, HandoffDetail, HandoffChange } from '@/lib/api';
import { useMeta, Spin, Explainer } from '@/components/common';
import { disclaimerLong } from '@/lib/brand';
import { pct, pts } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const ROW_ZERO_URL = 'https://rowzero.com/';

const fmtVal = (v: number | null, unit: string | null) => {
  if (v == null) return '—';
  if (unit === 'pct') return (v * 100).toFixed(2) + '%';
  if (unit === 'factor') return v.toFixed(3);
  return String(v);
};

// Audit actions in plain words for the timeline.
const ACTION_LABEL: Record<string, string> = {
  HANDOFF_SENT: 'Pack sent to the spreadsheet', HANDOFF_RETURNED: 'Workbook returned',
  HANDOFF_CHECKED: 'Every row checked', HANDOFF_APPLIED: 'Accepted changes applied',
  HANDOFF_APPLY_FAILED: 'Applying failed', CREATE: 'Scenario created', FROM_SPREADSHEET: 'Assumptions taken from the spreadsheet',
  EDIT: 'Assumptions edited', CALCULATE: 'Indication calculated by the governed engine', SUBMIT: 'Submitted for approval',
  APPROVE: 'Approved', REJECT: 'Rejected', APPROVE_DENIED: 'Approval blocked (role too junior)',
};

const STEPS = ['Send the pack', 'Work in the spreadsheet', 'Return & check', 'Apply & approve'];

function stepOf(h: Handoff | null): number {
  if (!h) return 0;
  if (h.status === 'SENT') return 1;
  if (h.status === 'RETURNED') return 3;
  return 4;
}

function StatusBadge({ s }: { s: HandoffChange['check_status'] }) {
  if (s === 'ACCEPTED') return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />Accepted</Badge>;
  if (s === 'REJECTED') return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Rejected</Badge>;
  return <Badge variant="outline" className="gap-1"><MinusCircle className="h-3 w-3" />Unchanged</Badge>;
}

export default function Spreadsheet() {
  const meta = useMeta()!;
  const [list, setList] = useState<Handoff[]>([]);
  const [persona, setPersona] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [d, setD] = useState<HandoffDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = async (select?: string) => {
    const r = await api.handoffs();
    setList(r.handoffs);
    setPersona(p => p || r.default_persona);
    const id = select ?? active ?? r.handoffs[0]?.handoff_id ?? null;
    setActive(id);
    return id;
  };
  const loadDetail = async (id: string | null) => { if (id) setD(await api.handoff(id)); else setD(null); };

  useEffect(() => { loadList().then(loadDetail); }, []);
  useEffect(() => { if (active && d?.handoff.handoff_id !== active) loadDetail(active); }, [active]);
  // While the governed engine is applying the changes, watch the audit events arrive.
  useEffect(() => {
    if (d?.handoff.status !== 'APPLYING') return;
    const t = setInterval(() => loadDetail(d.handoff.handoff_id).then(() => loadList(d.handoff.handoff_id)), 3000);
    return () => clearInterval(t);
  }, [d?.handoff.status, d?.handoff.handoff_id]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); }
    finally { setBusy(null); }
  };

  const doSend = () => run('send', async () => {
    const r = await api.sendToSpreadsheet(persona);
    const id = await loadList(r.handoff_id);
    await loadDetail(id);
  });
  const doReturn = () => run('return', async () => {
    const f = fileRef.current?.files?.[0];
    if (!f || !active) throw new ApiError('Choose the workbook to return first.', 400, {});
    await api.returnWorkbook(active, f);
    if (fileRef.current) fileRef.current.value = '';
    await loadDetail(active); await loadList(active);
  });
  const doPull = () => run('pull', async () => {
    if (!active) return;
    await api.pullRowZero(active);
    await loadDetail(active); await loadList(active);
  });
  const doApply = () => run('apply', async () => {
    if (!active) return;
    await api.applyHandoff(active);
    await loadDetail(active);
  });

  const h = d?.handoff ?? null;
  const step = stepOf(h);
  const changes = d?.changes ?? [];
  const shown = changes.filter(c => showUnchanged || c.check_status !== 'UNCHANGED');
  const nUnchanged = changes.filter(c => c.check_status === 'UNCHANGED').length;
  const applying = h?.status === 'APPLYING';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Spreadsheet review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your colleague keeps working in a spreadsheet. The platform keeps the record — and only checked,
          recalculated, approved numbers become official.
        </p>
      </div>

      <Explainer>
        This page is the round trip for a colleague who prefers to review assumptions in a spreadsheet
        (here Row Zero, which works like Excel). <b>Send</b> prepares a workbook of today's approved
        assumptions with the experience behind them, sealed so we know exactly which values were sent.
        Your colleague works on it however they like — their own formulas, pivots and charts — and changes
        only two columns: the proposed value and the reason. <b>Return</b> brings the workbook back and
        checks every row: the grey columns must be untouched, values must be sensible, every change needs a
        reason, and nobody must have changed the approved value in the meantime. <b>Apply</b> turns the
        accepted changes into scenarios that the governed engine recalculates (the spreadsheet never
        produces the official number), and submits them for approval by someone senior enough for the size
        of the change. Every step lands in the audit trail below.
      </Explainer>

      {/* progress */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s} className={cn('rounded-lg border px-3 py-2 text-sm',
            i < step ? 'border-success/40 bg-success/10' : i === step ? 'border-primary bg-primary/5 font-semibold' : 'text-muted-foreground')}>
            <span className="mr-1.5 tnum">{i + 1}.</span>{s}
          </div>
        ))}
      </div>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {d?.apply_error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{d.apply_error}</div>}

      {/* 1 — send */}
      <Card><CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Send className="h-3.5 w-3.5" /> 1 · Send the review pack
        </div>
        {(!h || h.status === 'APPLIED') ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[320px] flex-1 text-sm">
              <span className="text-muted-foreground">Prepared for</span>
              <input value={persona} onChange={e => setPersona(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
            <Button onClick={doSend} disabled={!!busy} className="gap-2">
              {busy === 'send' ? <Spin /> : <FileSpreadsheet className="h-4 w-4" />} Send review pack
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 text-sm md:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <div><span className="text-muted-foreground">Hand-off</span> <span className="font-semibold">{h.handoff_id}</span> · for {h.author_persona}</div>
              <div className="text-muted-foreground">
                {h.row_count} rows (every segment × assumption) · experience data {h.experience_version} ·
                seal <code className="rounded bg-muted px-1">{h.seal}</code>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="gap-2"><a href={api.packUrl(h.handoff_id)}><Download className="h-4 w-4" />Download pack (.xlsx)</a></Button>
              <Button asChild variant="secondary" className="gap-2"><a href={ROW_ZERO_URL} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open Row Zero</a></Button>
            </div>
          </div>
        )}
      </CardContent></Card>

      {/* 2 — work in the spreadsheet */}
      {h && h.status !== 'APPLIED' && (
        <Card><CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5" /> 2 · Work in the spreadsheet
          </div>
          <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
            <li>In Row Zero: <b>Home → File upload</b>, choose the pack. It opens on the Assumptions sheet.</li>
            <li>Work as usual — add sheets, formulas, pivots. Only the <span className="rounded bg-warning/20 px-1">yellow</span> columns come back: <b>proposed_value</b> and <b>rationale</b>.</li>
            <li>Leave the grey columns alone — they prove which approved value was reviewed.</li>
            <li>Bring it back: <b>File → Download</b> as .xlsx and return it below. Once Row Zero is connected to this
              workspace, use <b>Export to Databricks</b> as <code className="rounded bg-muted px-1">{d?.rowzero_table}</code> instead — no file on a laptop.</li>
          </ol>
        </CardContent></Card>
      )}

      {/* 3 — return & check */}
      {h && h.status !== 'APPLIED' && (
        <Card><CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Upload className="h-3.5 w-3.5" /> 3 · Return &amp; check
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" className="text-sm" disabled={applying} />
            <Button onClick={doReturn} disabled={!!busy || applying} className="gap-2">
              {busy === 'return' ? <Spin /> : <Upload className="h-4 w-4" />} Return workbook
            </Button>
            <Button variant="outline" onClick={doPull} disabled={!!busy || applying} className="gap-2"
              title="Reads Row Zero's Export to Databricks table instead of a file">
              {busy === 'pull' ? <Spin /> : <Database className="h-4 w-4" />} Read Row Zero export
            </Button>
          </div>
        </CardContent></Card>
      )}

      {/* check results */}
      {h && changes.length > 0 && (
        <Card><CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> What came back — checked row by row
            </div>
            <Badge variant="success">{h.accepted ?? 0} accepted</Badge>
            <Badge variant="destructive">{h.rejected ?? 0} rejected</Badge>
            <Badge variant="outline">{h.unchanged ?? 0} unchanged</Badge>
            {h.returned_at && <span className="text-xs text-muted-foreground">returned {h.returned_at.slice(0, 16).replace('T', ' ')} via {h.return_source === 'rowzero_export' ? 'Row Zero export' : 'file'} · sha256 {h.return_sha256?.slice(0, 12)}…</span>}
            <button className="ml-auto text-xs text-primary underline-offset-4 hover:underline" onClick={() => setShowUnchanged(v => !v)}>
              {showUnchanged ? 'hide' : 'show'} {nUnchanged} unchanged
            </button>
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Segment</TableHead><TableHead>Assumption</TableHead>
              <TableHead className="text-right">Approved</TableHead><TableHead className="text-right">Proposed</TableHead>
              <TableHead>Rationale</TableHead><TableHead>Result</TableHead><TableHead>Why</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map(c => (
                <TableRow key={c.row_id} className="hover:bg-transparent">
                  <TableCell className="whitespace-nowrap">{c.product ?? c.lob_code} · {c.territory ?? c.territory_code}</TableCell>
                  <TableCell>{c.assumption_label ?? c.assumption_name ?? c.row_id}</TableCell>
                  <TableCell className="text-right tnum">{fmtVal(c.current_value, c.unit)}</TableCell>
                  <TableCell className="text-right tnum font-semibold">{fmtVal(c.proposed_value, c.unit)}</TableCell>
                  <TableCell className="max-w-[26ch] text-xs text-muted-foreground">{c.rationale || '—'}</TableCell>
                  <TableCell><StatusBadge s={c.check_status} /></TableCell>
                  <TableCell className="max-w-[34ch] text-xs">{c.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {/* 4 — apply & approve */}
      {h && (h.status === 'RETURNED' || applying || h.status === 'APPLIED') && (
        <Card><CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" /> 4 · Apply &amp; approve
          </div>
          {h.status === 'RETURNED' && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Button onClick={doApply} disabled={!!busy || !(h.accepted ?? 0)} className="gap-2">
                {busy === 'apply' ? <Spin /> : <ArrowRight className="h-4 w-4" />} Apply {h.accepted ?? 0} accepted change(s)
              </Button>
              <span className="text-muted-foreground">One scenario per segment, recalculated by the governed engine and submitted for approval. Rejected rows are not applied.</span>
            </div>
          )}
          {applying && <div className="flex items-center gap-2 text-sm"><Spin /> Recalculating with the governed engine — watch the audit trail below.</div>}
          {(d?.scenarios.length ?? 0) > 0 && (
            <>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Scenario</TableHead><TableHead>Segment</TableHead>
                  <TableHead className="text-right">Approved baseline</TableHead><TableHead className="text-right">New indication</TableHead>
                  <TableHead className="text-right">Change</TableHead><TableHead>Needs sign-off by</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {d!.scenarios.map(s => (
                    <TableRow key={s.scenario_id} className="hover:bg-transparent">
                      <TableCell className="text-xs">{s.scenario_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{s.lob_code} · {s.territory_code}</TableCell>
                      <TableCell className="text-right tnum">{pct(s.baseline_indicated)}</TableCell>
                      <TableCell className="text-right tnum font-semibold">{pct(s.indicated_rate_change)}</TableCell>
                      <TableCell className="text-right tnum">{s.baseline_indicated != null && s.indicated_rate_change != null ? pts((s.indicated_rate_change - s.baseline_indicated) * 100) : '—'}</TableCell>
                      <TableCell><Badge variant="outline">{s.requires}</Badge></TableCell>
                      <TableCell><Badge variant={s.status === 'APPROVED' ? 'success' : 'warning'}>{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button asChild variant="outline" size="sm" className="gap-2"><Link to="/review">Go to Review &amp; Approve <ArrowRight className="h-3.5 w-3.5" /></Link></Button>
            </>
          )}
        </CardContent></Card>
      )}

      {/* audit trail */}
      {h && (d?.events.length ?? 0) > 0 && (
        <Card><CardContent className="space-y-2 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Audit trail — append-only, every step attributed
          </div>
          <ol className="space-y-1.5 text-sm">
            {d!.events.map((e, i) => (
              <li key={i} className="grid grid-cols-[9.5rem_1fr] gap-3">
                <span className="tnum text-xs text-muted-foreground">{e.log_ts.slice(0, 19).replace('T', ' ')}</span>
                <span><span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                  <span className="text-muted-foreground"> · {e.actor}{e.scenario_id !== h.handoff_id ? ` · ${e.scenario_id}` : ''}{e.note ? ` — ${e.note}` : ''}</span></span>
              </li>
            ))}
          </ol>
        </CardContent></Card>
      )}

      {/* earlier hand-offs */}
      {list.length > 1 && (
        <Card><CardContent className="space-y-2 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier hand-offs</div>
          <div className="flex flex-wrap gap-2">
            {list.map(x => (
              <button key={x.handoff_id} onClick={() => setActive(x.handoff_id)}
                className={cn('rounded-md border px-2.5 py-1 text-xs', x.handoff_id === active ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
                {x.handoff_id} · {x.status}
              </button>
            ))}
          </div>
        </CardContent></Card>
      )}

      {!d && !busy && list.length === 0 && <p className="text-sm text-muted-foreground">No hand-offs yet — send the first review pack above.</p>}

      <p className="pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">About this demo. </span>
        {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </p>
    </div>
  );
}
