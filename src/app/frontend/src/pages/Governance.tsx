import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, FileClock, RefreshCw, Scale, GitCompare, ListChecks, HelpCircle } from 'lucide-react';
import { api, GovernanceOverview, GovQuestion, AgentResult } from '@/lib/api';
import { useMeta, useAiMode, Spin, SourceChip, Explainer } from '@/components/common';
import { GenieBox } from '@/components/genie-box';
import { disclaimerLong } from '@/lib/brand';
import { pct } from '@/lib/format';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// A single "scary governance question" the process owner asks — click it, get a
// grounded answer from the live governed record (the demo centrepiece).
function AnswerCard({ q, mode }: { q: GovQuestion; mode: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<AgentResult | null>(null);
  const ask = async () => { setBusy(true); try { setR(await api.agentGovernance(q.q, mode)); } finally { setBusy(false); } };
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <Badge variant="secondary" className="w-fit text-[10px]">{q.persona}</Badge>
        <CardTitle className="text-sm leading-snug">{q.q}</CardTitle>
      </CardHeader>
      <CardContent className="mt-auto space-y-2">
        <Button variant="outline" size="sm" onClick={ask} disabled={busy}>
          <HelpCircle className="h-4 w-4" />Answer from the record{busy && <Spin />}
        </Button>
        {r && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <SourceChip source={r.source} />
              <span className="text-[11px] text-muted-foreground">advise-only — reporting the governed record</span>
            </div>
            <p className="whitespace-pre-wrap">{r.answer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ icon, label, value, tone = 'neutral', note, children }: {
  icon: React.ReactNode; label: string; value: React.ReactNode;
  tone?: 'ok' | 'warn' | 'neutral'; note?: string; children?: React.ReactNode;
}) {
  const glyph = tone === 'ok' ? '✓' : tone === 'warn' ? '⚠' : '';
  const cls = tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-amber-600 dark:text-amber-500' : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription className="flex items-center gap-2 text-[11px] uppercase tracking-wide">{icon}{label}</CardDescription>
        <CardTitle className={'text-2xl tnum ' + cls}>{glyph && <span className="mr-1">{glyph}</span>}{value}</CardTitle>
      </CardHeader>
      {(note || children) && <CardContent className="pt-0 text-xs text-muted-foreground">{note}{children}</CardContent>}
    </Card>
  );
}

export default function Governance() {
  const meta = useMeta()!;
  const { mode } = useAiMode();
  const [g, setG] = useState<GovernanceOverview | null>(null);
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<AgentResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.getGovernance().then(setG).catch(() => {}); }, []);

  const askFree = async () => {
    if (!q.trim()) return;
    setBusy(true); try { setAns(await api.agentGovernance(q, mode)); } finally { setBusy(false); }
  };

  if (!g) return <div className="text-muted-foreground"><Spin /> Loading governance record…</div>;

  const statuses = Object.entries(g.scenarios_by_status);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Governance</h1>
        <p className="text-sm text-muted-foreground">Every figure below is a live query over the governed record — attribution, reproducibility, authorisation, tamper-evidence and filed-vs-technical rates.</p>
      </div>

      <Explainer>
        This page answers the questions an oversight owner needs to satisfy before rates are filed:
        who created or changed an assumption, whether a number can be reproduced exactly later, whether
        every change was signed off by someone senior enough, whether anyone approved their own work,
        whether the record can be tampered with, and where a filed rate differs from the technical
        indication and why. Click a question to have it answered from the live record.
      </Explainer>

      {/* Evidence KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi icon={<FileClock className="h-3.5 w-3.5" />} label="Audit trail" value={g.attribution.total_events}
             tone="ok" note={g.attribution.append_only ? 'append-only — events, never edits or deletes' : 'not append-only'} />
        <Kpi icon={<RefreshCw className="h-3.5 w-3.5" />} label="Reproducible results" value={`${g.reproducibility.pct}%`}
             tone={g.reproducibility.pct >= 100 ? 'ok' : 'warn'}
             note={`${g.reproducibility.with_snapshot}/${g.reproducibility.results_total} carry a snapshot + hash · calc ${g.reproducibility.calc_versions.join(', ')}`} />
        <Kpi icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Unauthorised approvals blocked" value={g.authorisation.denied_attempts} tone="ok">
          <ul className="mt-1 space-y-1">
            {g.authorisation.denied_examples.map((d, i) => (
              <li key={i} className="truncate" title={`${d.actor} · ${d.note}`}>{d.actor} — {d.note}</li>
            ))}
          </ul>
        </Kpi>
        <Kpi icon={<Scale className="h-3.5 w-3.5" />} label="Segregation of duties"
             value={g.segregation_of_duties.self_approved_count}
             tone={g.segregation_of_duties.self_approved_count === 0 ? 'ok' : 'warn'}
             note={g.segregation_of_duties.self_approved_count === 0 ? 'no self-approved scenarios' : 'self-approved scenarios present'} />
        <Kpi icon={<GitCompare className="h-3.5 w-3.5" />} label="Filed vs technical rate"
             value={g.selected_vs_indicated.deviations}
             tone={g.selected_vs_indicated.deviations === g.selected_vs_indicated.with_reason ? 'ok' : 'warn'}
             note={`${g.selected_vs_indicated.with_reason} of ${g.selected_vs_indicated.deviations} deviations have a recorded reason`}>
          <ul className="mt-1 space-y-1">
            {g.selected_vs_indicated.examples.slice(0, 4).map((e, i) => (
              <li key={i} className="truncate">{e.segment}: selected {pct(e.selected)} vs indicated {pct(e.indicated)}</li>
            ))}
          </ul>
        </Kpi>
        <Kpi icon={<ListChecks className="h-3.5 w-3.5" />} label="Book coverage"
             value={`${g.coverage.approved_baselines}/${g.coverage.segments}`} tone="neutral"
             note="segments with an approved baseline indication">
          <div className="mt-1 flex flex-wrap gap-1">
            {statuses.map(([s, n]) => <Badge key={s} variant="secondary" className="text-[10px]">{s} {n}</Badge>)}
          </div>
        </Kpi>
      </div>

      {/* Ready-answer question cards — the centrepiece */}
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5" />Ask the hard questions</h2>
        <p className="mb-3 text-sm text-muted-foreground">The questions the process owner is accountable for — each answered from the live governed record.</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {g.questions.map(qq => <AnswerCard key={qq.key} q={qq} mode={mode} />)}
        </div>
      </div>

      {/* Free-text governance Q&A */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Ask a governance question</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Who approved the largest rate increase this period?"
                   onKeyDown={e => e.key === 'Enter' && askFree()} />
            <Button onClick={askFree} disabled={busy}>Ask{busy && <Spin />}</Button>
          </div>
          {ans && (
            <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2"><SourceChip source={ans.source} />
                <span className="text-[11px] text-muted-foreground">advise-only — reporting the governed record</span></div>
              <p className="whitespace-pre-wrap">{ans.answer}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {meta.genie_enabled && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Query the record directly</h2>
          <GenieBox placeholder="Ask the audit/approval record…" suggestions={[
            'Show every approval and who signed it',
            'List blocked approval attempts',
            'Which scenarios are still in draft?',
          ]} />
        </div>
      )}

      <p className="pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">About this demo. </span>
        {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </p>
    </div>
  );
}
