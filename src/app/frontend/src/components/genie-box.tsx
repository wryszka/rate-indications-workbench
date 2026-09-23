import { useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { api, GenieAnswer } from '@/lib/api';
import { Spin } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const isNum = (v: any) => v !== null && v !== '' && !isNaN(Number(v));

// Compact, single-turn "Ask the book" widget woven into pages (the full multi-turn
// version is the /ask tab). Render only when meta.genie_enabled.
export function GenieBox({ suggestions = [], placeholder = 'Ask the book…' }: { suggestions?: string[]; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [a, setA] = useState<GenieAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState<string | undefined>(undefined);
  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true); setQ('');
    try { const r = await api.genieAsk(t, conv); if (r.conversation_id) setConv(r.conversation_id); setA(r); }
    catch { setA({ enabled: true, answer: 'Ask failed — try rephrasing.' } as any); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <MessageCircleQuestion className="h-3.5 w-3.5" /> Ask the book
      </div>
      <div className="flex gap-2">
        <Input value={q} placeholder={placeholder} className="h-8"
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(q); }} />
        <Button size="sm" onClick={() => ask(q)} disabled={busy || !q.trim()}>Ask {busy && <Spin />}</Button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map(s => <Button key={s} size="sm" variant="outline" className="h-7 text-xs" onClick={() => ask(s)} disabled={busy}>{s}</Button>)}
        </div>
      )}
      {a && (
        <div className="space-y-2 border-t pt-2">
          <p className="text-sm text-muted-foreground">{a.answer}</p>
          {a.sql && (
            <Accordion type="single" collapsible>
              <AccordionItem value="s" className="border-0">
                <AccordionTrigger className="py-1 text-xs text-muted-foreground">Query it ran</AccordionTrigger>
                <AccordionContent><pre className="overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">{a.sql}</pre></AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
          {a.columns && a.rows && a.rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>{a.columns.map(c => <TableHead key={c} className={isNum(a.rows![0][a.columns!.indexOf(c)]) ? 'text-right' : ''}>{c}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {a.rows.slice(0, 10).map((row, i) => (
                    <TableRow key={i} className="hover:bg-transparent">{row.map((v, j) => <TableCell key={j} className={isNum(v) ? 'text-right tnum' : ''}>{String(v ?? '')}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
