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

  const useCases = [...new Set(cards.map(c => c.use_case))];
  const intro: Record<string, string> = {
    'On-level earned premium': 'Restate historic earned premium to a reference rate level, so experience is judged on a fair basis — the step that feeds the indication.',
    'Rate indication': 'From governed experience to a signed-off, reproducible rate change — the full price-decision workflow.',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Learn — how it works</h1>
        <p className="mt-1 text-sm text-muted-foreground">Two use cases, one engine. Every step maps to the governed object behind it — behind the scenes is a click, never a hand-wave.</p>
      </div>

      <LearnTabs useCases={useCases} intro={intro} cards={cards} />

      <Card className="border-amber-500/30 bg-warning/[0.06]"><CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span><span className="font-semibold text-foreground">About this demo. </span>{disclaimerLong(meta.entity_name).replace('About this demo. ', '')}</span>
      </CardContent></Card>
    </div>
  );
}

function LearnTabs({ useCases, intro, cards }: { useCases: string[]; intro: Record<string, string>; cards: LearnCard[] }) {
  const [active, setActive] = useState(useCases[0]);
  const ucCards = cards.filter(c => c.use_case === active);
  const groups = [...new Set(ucCards.map(c => c.group))];
  return (
    <div className="space-y-4">
      {/* two tabs, one per use case */}
      <div className="inline-flex rounded-lg border bg-muted/40 p-1">
        {useCases.map(uc => (
          <button key={uc} onClick={() => setActive(uc)}
            className={'rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
              (uc === active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {uc}
          </button>
        ))}
      </div>
      {intro[active] && <p className="text-sm text-muted-foreground">{intro[active]}</p>}
      <div className="space-y-3">
        {groups.map(g => (
              <div key={g}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g}</div>
                <div className="space-y-3">
                  {ucCards.filter(c => c.group === g).map(c => (
                    <Card key={active + c.n}><CardContent className="flex items-start gap-3 p-4">
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
    </div>
  );
}
