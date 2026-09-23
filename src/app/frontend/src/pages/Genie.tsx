import { useState } from 'react';
import { Send } from 'lucide-react';
import { api, GenieAnswer } from '@/lib/api';
import { Spin, Explainer, useMeta } from '@/components/common';
import { disclaimerLong } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

type Turn = { q: string; a?: GenieAnswer; error?: string };
const SUGGESTIONS = [
  'Which segments have the largest indicated rate increase?',
  'What is the earned premium by territory for General Liability?',
  'Show the loss ratio by product',
];
const isNum = (v: any) => v !== null && v !== '' && !isNaN(Number(v));

export default function Genie() {
  const meta = useMeta()!;
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | undefined>(undefined);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setQ('');
    setTurns(t => [...t, { q: text }]);
    try {
      const a = await api.genieAsk(text, conv);
      if (a.conversation_id) setConv(a.conversation_id);
      setTurns(t => t.map((turn, i) => (i === t.length - 1 ? { ...turn, a } : turn)));
    } catch (e: any) {
      setTurns(t => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: e.message || 'failed' } : turn)));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ask the book</h1>
        <p className="mt-1 text-sm text-muted-foreground">Natural-language questions over the same governed experience the indications are built on.</p>
      </div>

      <Explainer>
        Ask a plain-English question about the book — premiums, losses, loss ratios, indications by product or
        territory — and get an answer back, with the query it ran and the rows it returned. It reads the same
        governed data the rest of the workbench uses; it doesn't change anything.
      </Explainer>

      <Card><CardContent className="space-y-3 p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Label className="mb-1 block">Your question</Label>
            <Input value={q} placeholder="e.g. which segments need the biggest increase?"
              onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(q); }} />
          </div>
          <Button onClick={() => ask(q)} disabled={busy || !q.trim()}><Send className="h-4 w-4" /> Ask {busy && <Spin />}</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => <Button key={s} size="sm" variant="outline" onClick={() => ask(s)} disabled={busy}>{s}</Button>)}
        </div>
      </CardContent></Card>

      {turns.slice().reverse().map((t, ri) => (
        <Card key={turns.length - 1 - ri}><CardContent className="space-y-2 p-4">
          <div className="font-semibold">{t.q}</div>
          {!t.a && !t.error && <div className="text-muted-foreground"><Spin /> thinking…</div>}
          {t.error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{t.error}</div>}
          {t.a && (
            <>
              <p className="text-sm text-muted-foreground">{t.a.answer}</p>
              {t.a.sql && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="sql" className="border-0">
                    <AccordionTrigger className="text-muted-foreground">Query it ran</AccordionTrigger>
                    <AccordionContent><pre className="overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs text-muted-foreground">{t.a.sql}</pre></AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              {t.a.columns && t.a.rows && t.a.rows.length > 0 && (
                <Table>
                  <TableHeader><TableRow>{t.a.columns.map(c => <TableHead key={c} className={isNum(t.a!.rows![0][t.a!.columns!.indexOf(c)]) ? 'text-right' : ''}>{c}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>
                    {t.a.rows.map((row, i) => (
                      <TableRow key={i} className="hover:bg-transparent">{row.map((v, j) => <TableCell key={j} className={isNum(v) ? 'text-right tnum' : ''}>{String(v ?? '')}</TableCell>)}</TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {t.a.enabled === false && <Badge variant="outline">Genie not configured</Badge>}
            </>
          )}
        </CardContent></Card>
      ))}

      <p className="pt-2 text-xs text-muted-foreground">
        <span className="font-semibold">About this demo. </span>
        {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}
      </p>
    </div>
  );
}
