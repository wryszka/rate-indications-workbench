import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { api, LearnCard } from '@/lib/api';
import { useMeta, Spin } from '@/components/common';
import { disclaimerLong } from '@/lib/brand';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Learn() {
  const meta = useMeta()!;
  const [cards, setCards] = useState<LearnCard[] | null>(null);
  useEffect(() => { api.learn().then(d => setCards(d.cards)); }, []);
  if (!cards) return <div><h1 className="text-2xl font-bold tracking-tight">Learn</h1><Card className="mt-4"><CardContent className="p-6"><Spin /></CardContent></Card></div>;

  const groups = [...new Set(cards.map(c => c.group))];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Learn — how it works</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every step of the workflow, and the governed object behind it. Behind the scenes is a click, never a hand-wave.</p>
      </div>

      <div className="space-y-4">
        {groups.map(g => (
          <div key={g}>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g}</div>
            <div className="space-y-3">
              {cards.filter(c => c.group === g).map(c => (
                <Card key={c.n}><CardContent className="flex items-start gap-3 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{c.n}</div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{c.activity}</div>
                    <div className="text-sm text-muted-foreground">{c.how}</div>
                    <div className="flex flex-wrap gap-1.5 pt-1">{c.links.map((l, i) => <Badge key={i} variant="outline" className="font-normal">{l.label}</Badge>)}</div>
                  </div>
                </CardContent></Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Card className="border-amber-500/30 bg-warning/[0.06]"><CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span><span className="font-semibold text-foreground">About this demo. </span>{disclaimerLong(meta.entity_name).replace('About this demo. ', '')}</span>
      </CardContent></Card>
    </div>
  );
}
