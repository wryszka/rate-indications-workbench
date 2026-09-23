import { createContext, useContext, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, Meta, Step } from '@/lib/api';
import { pts } from '@/lib/format';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

// ---- meta context (loaded once) ----
const MetaCtx = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaCtx);

// AI live/cached mode (the "yellow button"), shared app-wide.
const AiModeCtx = createContext<{ mode: string; setMode: (m: string) => void }>({ mode: 'cached', setMode: () => {} });
export const useAiMode = () => useContext(AiModeCtx);

export function MetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setModeState] = useState('cached');
  useEffect(() => { api.meta().then(m => { setMeta(m); setModeState(m.ai_mode); }).catch(() => {}); }, []);
  const setMode = (m: string) => { setModeState(m); api.setAiMode(m).catch(() => {}); };
  if (!meta) return <div className="flex h-screen items-center justify-center gap-2 text-muted-foreground"><Spin /> Loading…</div>;
  return (
    <MetaCtx.Provider value={meta}>
      <AiModeCtx.Provider value={{ mode, setMode }}>{children}</AiModeCtx.Provider>
    </MetaCtx.Provider>
  );
}

export const Spin = () => <Loader2 className="inline h-4 w-4 animate-spin text-muted-foreground" aria-label="loading" />;

// ---- "What am I seeing?" explainer (no platform words) ----
export function Explainer({ title = 'What am I seeing?', children }: { title?: string; children: React.ReactNode }) {
  return (
    <Accordion type="single" collapsible className="mb-4 rounded-lg border bg-muted/30 px-4">
      <AccordionItem value="x" className="border-0">
        <AccordionTrigger className="text-sm text-muted-foreground">{title}</AccordionTrigger>
        <AccordionContent className="max-w-[74ch] text-sm leading-relaxed text-muted-foreground">{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ---- decomposition waterfall (chart tokens; sign always shown) ----
export function Waterfall({ steps }: { steps: Step[] }) {
  if (!steps.length) return <p className="text-sm text-muted-foreground">No differences from the approved baseline yet — edit an assumption to see the drivers.</p>;
  const max = Math.max(...steps.map(s => Math.abs(s.contribution_pts)), 0.1);
  return (
    <div className="space-y-2">
      {steps.map(s => {
        const w = (Math.abs(s.contribution_pts) / max) * 100;
        const positive = s.contribution_pts >= 0;
        const premium = s.group === 'Premium';   // the on-level / premium-basis step, distinct colour
        const bar = premium ? 'hsl(var(--chart-4))' : positive ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))';
        return (
          <div key={s.assumption} className="grid grid-cols-[9rem_1fr_5rem] items-center gap-3 text-sm">
            <div className="truncate text-muted-foreground" title={s.label}>
              {premium && <span className="mr-1 align-middle text-[10px] font-bold uppercase text-muted-foreground/70">◆</span>}{s.label}
            </div>
            <div className="relative h-4 rounded bg-muted">
              <div className="absolute top-0 h-4 w-px bg-border" style={{ left: '50%' }} />
              <div className="absolute top-0 h-4 rounded"
                style={{ left: positive ? '50%' : `${50 - w / 2}%`, width: `${w / 2}%`, background: bar }} />
            </div>
            <div className={'text-right tnum font-medium ' + (positive ? 'text-success' : 'text-destructive')}>{pts(s.contribution_pts)}</div>
          </div>
        );
      })}
    </div>
  );
}
