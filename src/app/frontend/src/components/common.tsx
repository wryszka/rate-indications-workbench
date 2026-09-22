import { createContext, useContext, useEffect, useState } from 'react';
import { api, Meta, Step } from '../lib/api';
import { pts } from '../lib/format';

// ---- meta context (loaded once) ----
const MetaCtx = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaCtx);

export function MetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { api.meta().then(setMeta).catch(() => {}); }, []);
  if (!meta) return <div className="main"><Spin /> Loading…</div>;
  return <MetaCtx.Provider value={meta}>{children}</MetaCtx.Provider>;
}

export const Spin = () => <span className="spin" aria-label="loading" />;

// ---- "What am I seeing?" explainer (no platform words) ----
export function Explainer({ title = 'What am I seeing?', children }: { title?: string; children: React.ReactNode }) {
  return (
    <details className="exp">
      <summary>{title}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

// ---- decomposition waterfall ----
export function Waterfall({ steps }: { steps: Step[] }) {
  if (!steps.length) return <p className="mut" style={{ fontSize: 13 }}>No differences from the approved baseline yet — edit an assumption to see the drivers.</p>;
  const max = Math.max(...steps.map(s => Math.abs(s.contribution_pts)), 0.1);
  return (
    <div className="wf">
      {steps.map(s => {
        const w = (Math.abs(s.contribution_pts) / max) * 100;
        const positive = s.contribution_pts >= 0;
        return (
          <div className="bar" key={s.assumption}>
            <div className="barname">{s.label}</div>
            <div className="bartrack">
              <div className="barfill" style={{
                left: positive ? '50%' : `${50 - w / 2}%`,
                width: `${w / 2}%`,
                background: positive ? 'var(--emerald)' : 'var(--red)',
              }} />
            </div>
            <div className={'barval ' + (positive ? 'pos' : 'neg')}>{pts(s.contribution_pts)}</div>
          </div>
        );
      })}
    </div>
  );
}
