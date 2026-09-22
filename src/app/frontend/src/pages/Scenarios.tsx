import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, Scenario, ScenarioDetail } from '../lib/api';
import { useMeta, Spin, Explainer } from '../components/common';
import { pct, toDisplay, fromDisplay, unitSuffix } from '../lib/format';

const STATUS_CHIP: Record<string, string> = {
  APPROVED: 'active', DRAFT: 'plain', SUBMITTED: 'differs', REVIEWED: 'differs', REJECTED: 'quarantined', SUPERSEDED: 'superseded',
};

export default function Scenarios() {
  const meta = useMeta()!;
  const [sp] = useSearchParams();
  const [scns, setScns] = useState<Scenario[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(sp.get('open'));
  const [cmp, setCmp] = useState<{ scenarios: ScenarioDetail[]; assumption_order: string[]; assumption_meta: any } | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = () => { setLoading(true); api.scenarios().then(d => { setScns(d.scenarios); setLoading(false); }); };
  useEffect(() => { reload(); }, []);

  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 3 ? [...s, id] : s);
  const doCompare = () => api.compare(sel).then(setCmp);

  return (
    <main className="main">
      <h2>Scenarios</h2>
      <p className="mut" style={{ marginTop: 2, fontSize: 13 }}>Saved assumption sets across the book — clone, compare, calculate and take through review.</p>

      <Explainer>
        A scenario is a named set of assumptions for one product × territory × period, with a workflow status.
        The <em>Approved Baseline</em> is the current approved basis. Tick two or three to compare them
        side by side, or open a draft to edit its assumptions, recalculate (which records the result), set a
        selected rate and submit it for review.
      </Explainer>

      {sel.length >= 2 && (
        <div className="banner" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{sel.length} scenarios selected.</span>
          <button className="act" onClick={doCompare}>Compare side by side</button>
          <button className="ghost" onClick={() => { setSel([]); setCmp(null); }}>Clear</button>
        </div>
      )}

      {cmp && <Compare cmp={cmp} />}

      {loading ? <div className="card"><Spin /> Loading…</div> : (
        <div className="card">
          <table>
            <thead><tr>
              <th style={{ width: 30 }}></th><th>Scenario</th><th>Product · Territory</th><th>Status</th>
              <th className="num">Indicated</th><th className="num">Selected</th><th></th>
            </tr></thead>
            <tbody>
              {scns.map(s => (
                <tr key={s.scenario_id}>
                  <td><input type="checkbox" checked={sel.includes(s.scenario_id)} onChange={() => toggle(s.scenario_id)} /></td>
                  <td>{s.scenario_name}{s.is_baseline && <span className="chip active" style={{ marginLeft: 6 }}>baseline</span>}</td>
                  <td className="mut">{s.lob_code} · {s.territory_code} · {s.indication_period}</td>
                  <td><span className={'chip ' + (STATUS_CHIP[s.status] || 'plain')}>{s.status}</span></td>
                  <td className="num">{s.indicated_rate_change != null ? pct(s.indicated_rate_change) : '—'}</td>
                  <td className="num">{s.selected_rate_change != null ? pct(s.selected_rate_change) : '—'}</td>
                  <td><button className="chipq" onClick={() => setOpen(s.scenario_id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <ScenarioEditor id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </main>
  );
}

function Compare({ cmp }: { cmp: { scenarios: ScenarioDetail[]; assumption_order: string[]; assumption_meta: any } }) {
  const cols = cmp.scenarios;
  const meta = cmp.assumption_meta;
  return (
    <div className="card">
      <div className="eyebrow">Scenario comparison</div>
      <table>
        <thead><tr><th>Metric</th>{cols.map(c => <th key={c.scenario.scenario_id} className="num">{c.scenario.scenario_name}</th>)}</tr></thead>
        <tbody>
          <tr><td className="aigrp" colSpan={cols.length + 1}>Result</td></tr>
          <tr><td>Projected loss ratio</td>{cols.map(c => <td key={c.scenario.scenario_id} className="num">{c.result ? pct(c.result.projected_loss_ratio, 1, false) : '—'}</td>)}</tr>
          <tr><td>Indicated rate change</td>{cols.map(c => <td key={c.scenario.scenario_id} className="num" style={{ fontWeight: 700 }}>{c.result ? pct(c.result.indicated_rate_change) : '—'}</td>)}</tr>
          <tr><td>Selected rate change</td>{cols.map(c => <td key={c.scenario.scenario_id} className="num">{c.scenario.selected_rate_change != null ? pct(c.scenario.selected_rate_change) : '—'}</td>)}</tr>
          <tr><td className="aigrp" colSpan={cols.length + 1}>Assumptions</td></tr>
          {cmp.assumption_order.map(n => {
            const m = meta[n];
            const vals = cols.map(c => c.assumptions[n]);
            const differ = new Set(vals.map(v => v?.toFixed(6))).size > 1;
            return (
              <tr key={n} style={differ ? { background: 'var(--amber-bg)' } : {}}>
                <td>{m.label}{differ && <span className="chip differs" style={{ marginLeft: 6 }}>differs</span>}</td>
                {cols.map((c, i) => <td key={c.scenario.scenario_id} className="num">{toDisplay(n, vals[i], m.unit)}{unitSuffix(m.unit)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioEditor({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<ScenarioDetail | null>(null);
  const [assum, setAssum] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState('');
  const [comment, setComment] = useState('');
  const load = () => api.scenario(id).then(v => { setD(v); setAssum({ ...v.assumptions }); setSel(v.scenario.selected_rate_change != null ? String((v.scenario.selected_rate_change * 100).toFixed(1)) : ''); });
  useEffect(() => { load(); }, [id]);
  if (!d) return <div className="card"><Spin /> Loading scenario…</div>;

  const editable = d.scenario.status === 'DRAFT' && !d.scenario.is_baseline;
  const recalc = async () => { setBusy('calc'); await api.saveAssumptions(id, assum); await api.calculate(id); await load(); onChanged(); setBusy(''); };
  const saveSel = async () => { setBusy('sel'); await api.selectRate(id, fromDisplay(sel, 'pct'), comment); await load(); onChanged(); setBusy(''); };
  const submit = async () => { setBusy('submit'); await api.submit(id); await load(); onChanged(); setBusy(''); };

  return (
    <div className="card" style={{ borderColor: 'var(--brand-line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="eyebrow" style={{ margin: 0 }}>{d.scenario.scenario_name} — {d.scenario.lob_code} · {d.scenario.territory_code} · {d.scenario.indication_period}</div>
        <button className="chipq" onClick={onClose}>Close</button>
      </div>
      <div style={{ margin: '8px 0' }}>
        <span className={'chip ' + (STATUS_CHIP[d.scenario.status] || 'plain')}>{d.scenario.status}</span>
        {d.result && <span className="mut" style={{ marginLeft: 10, fontSize: 12 }}>Indicated <strong>{pct(d.result.indicated_rate_change)}</strong> · projected LR {pct(d.result.projected_loss_ratio, 1, false)}</span>}
      </div>

      <div className="grid2">
        <div>
          <table>
            <thead><tr><th>Assumption</th><th className="num">Baseline</th><th className="num">{editable ? 'Scenario (editable)' : 'Scenario'}</th></tr></thead>
            <tbody>
              {d.assumption_order.map(n => {
                const m = d.assumption_meta[n];
                return (
                  <tr key={n}>
                    <td>{m.label}</td>
                    <td className="num mut">{toDisplay(n, d.baseline[n], m.unit)}{unitSuffix(m.unit)}</td>
                    <td className="num">
                      {editable
                        ? <input className="num" value={toDisplay(n, assum[n], m.unit)} onChange={e => setAssum(a => ({ ...a, [n]: fromDisplay(e.target.value, m.unit) }))} />
                        : <>{toDisplay(n, assum[n], m.unit)}{unitSuffix(m.unit)}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && <button className="act" onClick={recalc} disabled={busy === 'calc'} style={{ marginTop: 12 }}>Recalculate &amp; record {busy === 'calc' && <Spin />}</button>}
        </div>
        <div>
          <div className="aigrp">Selected rate</div>
          <p className="mut" style={{ fontSize: 12.5, marginTop: 0 }}>The indication is the actuary's answer; the selected rate is what management chooses to file — capture why they differ.</p>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Selected rate change (%)</label>
          <input className="num" style={{ display: 'block', margin: '4px 0' }} value={sel} onChange={e => setSel(e.target.value)} />
          <label style={{ fontSize: 12, fontWeight: 700 }}>Commentary</label>
          <textarea style={{ width: '100%', padding: 8, border: '1px solid var(--line2)', borderRadius: 8, font: 'inherit', minHeight: 60 }}
            value={comment} onChange={e => setComment(e.target.value)} placeholder="e.g. Severity trend raised on latest claims; selected rate moderated for competitive reasons." />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="ghost" onClick={saveSel} disabled={busy === 'sel'}>Save selection {busy === 'sel' && <Spin />}</button>
            {(d.scenario.status === 'DRAFT') && <button className="act" onClick={submit} disabled={busy === 'submit'}>Submit for review {busy === 'submit' && <Spin />}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
