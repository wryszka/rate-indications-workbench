import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, RotateCcw, Save } from 'lucide-react';
import { api, Result, Step, ScenarioDetail } from '../lib/api';
import { useMeta, Spin, Explainer, Waterfall } from '../components/common';
import { pct, pts, money, toDisplay, fromDisplay, unitSuffix, signClass, arrow } from '../lib/format';

export default function Indications() {
  const meta = useMeta()!;
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const lob = sp.get('lob') || 'GENERAL_LIABILITY';
  const territory = sp.get('territory') || 'DE';
  const period = Number(sp.get('period')) || meta.periods[0] || 2027;
  const setSeg = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n); };

  const [base, setBase] = useState<ScenarioDetail | null>(null);
  const [assum, setAssum] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ result: Result; decomposition: Step[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('Actuarial Recommended');
  const [explain, setExplain] = useState<{ answer: string; source: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const timer = useRef<any>(null);

  // load segment baseline
  useEffect(() => {
    setBase(null); setPreview(null); setExplain(null);
    api.segment(lob, territory, period).then(v => {
      setBase(v.baseline);
      setAssum({ ...v.baseline.assumptions });
    });
  }, [lob, territory, period]);

  // debounced live preview whenever assumptions change
  useEffect(() => {
    if (!base) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBusy(true);
      api.preview(lob, territory, period, assum)
        .then(p => setPreview({ result: p.result, decomposition: p.decomposition }))
        .finally(() => setBusy(false));
    }, 350);
    return () => timer.current && clearTimeout(timer.current);
  }, [assum, base]);

  if (!base) return <main className="main"><h2>Rate Indications</h2><div className="card"><Spin /> Loading segment…</div></main>;

  const baseRes = base.result!;
  const cur = preview?.result ?? baseRes;
  const dirty = JSON.stringify(assum) !== JSON.stringify(base.assumptions);
  const changePts = (cur.indicated_rate_change - baseRes.indicated_rate_change) * 100;
  const groups = ['Loss', 'Method', 'Provision'];
  const metaByName = base.assumption_meta;

  const doExplain = () => {
    setExplaining(true);
    api.explain({ payload: {
      segment: `${base.scenario.lob_code} / ${base.scenario.territory_code}`, period,
      result: cur, baseline_indicated: baseRes.indicated_rate_change, decomposition: preview?.decomposition ?? [],
    }, mode: meta.ai_mode })
      .then(r => setExplain({ answer: r.answer, source: r.source }))
      .finally(() => setExplaining(false));
  };

  const doSave = async () => {
    const { scenario_id } = await api.createScenario({ name, lob, territory, period });
    await api.saveAssumptions(scenario_id, assum);
    setSaveOpen(false);
    nav(`/scenarios?open=${scenario_id}`);
  };

  const prodLabel = meta.products.find(p => p.code === lob)?.label ?? lob;
  const terrLabel = meta.territories.find(t => t.code === territory)?.label ?? territory;

  return (
    <main className="main">
      <div className="hero">
        <h2>{prodLabel} · {terrLabel} · {period}</h2>
        <div className="meta">Loss-ratio rate indication {dirty ? '· unsaved preview — not recorded until saved & calculated' : '· showing the approved baseline'}</div>
      </div>

      <Explainer>
        We take this segment's earned premium and losses, restate old premium at today's rate level,
        develop losses to their expected final cost, trend them to {period}, then compare the projected
        loss ratio with the loss ratio the price can permit after expenses, commission, reinsurance and
        profit. The gap is the indicated rate change. Edit any assumption on the right and every number
        updates instantly; the waterfall shows which assumption moved it and by how much.
      </Explainer>

      <div className="selectrow">
        <div className="fld"><label>Product</label>
          <select value={lob} onChange={e => setSeg('lob', e.target.value)}>
            {meta.products.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select></div>
        <div className="fld"><label>Territory</label>
          <select value={territory} onChange={e => setSeg('territory', e.target.value)}>
            {meta.territories.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select></div>
        <div className="fld"><label>Period</label>
          <select value={period} onChange={e => setSeg('period', e.target.value)}>
            {meta.periods.map(y => <option key={y} value={y}>{y}</option>)}
          </select></div>
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={() => setAssum({ ...base.assumptions })} disabled={!dirty}>
          <RotateCcw size={14} style={{ verticalAlign: -2 }} /> Reset to baseline
        </button>
        <button className="act" onClick={() => setSaveOpen(true)} disabled={!dirty}>
          <Save size={14} style={{ verticalAlign: -2 }} /> Save as scenario
        </button>
      </div>

      <div className="tiles">
        <div className="tile"><div className="k">Current rate level</div><div className="v">{(baseRes.current_rate_level ?? 1).toFixed(3)}</div></div>
        <div className="tile"><div className="k">Projected loss ratio</div><div className="v">{pct(cur.projected_loss_ratio, 1, false)}</div></div>
        <div className="tile"><div className="k">Baseline indication</div><div className="v">{pct(baseRes.indicated_rate_change)}</div></div>
        <div className="tile"><div className="k">Scenario indication</div><div className={'v ' + (cur.indicated_rate_change >= 0 ? 'warn' : 'pos')}>{pct(cur.indicated_rate_change)} {busy && <Spin />}</div></div>
        <div className="tile"><div className="k">Change vs baseline</div><div className={'v ' + signClass(changePts / 100)}>{arrow(changePts / 100)} {pts(changePts)}</div></div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="eyebrow">Assumptions</div>
          <table>
            <thead><tr><th>Assumption</th><th className="num">Baseline</th><th className="num">Scenario</th></tr></thead>
            <tbody>
              {groups.map(g => {
                const names = base.assumption_order.filter(n => metaByName[n].group === g);
                if (!names.length) return null;
                return [
                  <tr key={g + 'h'}><td colSpan={3} className="aigrp">{g}</td></tr>,
                  ...names.map(n => {
                    const m = metaByName[n];
                    const bv = base.assumptions[n];
                    const changed = Math.abs((assum[n] ?? 0) - bv) > 1e-9;
                    return (
                      <tr key={n}>
                        <td>{m.label}</td>
                        <td className="num mut">{toDisplay(n, bv, m.unit)}{unitSuffix(m.unit)}</td>
                        <td className="num">
                          <input className="num" style={changed ? { borderColor: 'var(--brand)', fontWeight: 700 } : {}}
                            value={toDisplay(n, assum[n] ?? bv, m.unit)}
                            onChange={e => setAssum(a => ({ ...a, [n]: fromDisplay(e.target.value, m.unit) }))}
                            inputMode="decimal" />
                          <span className="mut" style={{ fontSize: 11, marginLeft: 3 }}>{unitSuffix(m.unit)}</span>
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="eyebrow">Why the indication moved</div>
          <p className="mut" style={{ marginTop: 0, fontSize: 13 }}>
            From <strong>{pct(baseRes.indicated_rate_change)}</strong> (baseline) to <strong className={cur.indicated_rate_change >= 0 ? '' : 'pos'}>{pct(cur.indicated_rate_change)}</strong> — contributions sum exactly to the {pts(changePts)} move.
          </p>
          <Waterfall steps={preview?.decomposition ?? []} />
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <button className="ghost" onClick={doExplain} disabled={explaining}>
              <Sparkles size={14} style={{ verticalAlign: -2 }} /> Explain indication {explaining && <Spin />}
            </button>
            {explain && (
              <div className="banner" style={{ marginTop: 12 }}>
                <span className={'chip ' + (explain.source === 'live' ? 'active' : 'plain')} style={{ marginRight: 8 }}>{explain.source}</span>
                {explain.answer}
              </div>
            )}
          </div>
        </div>
      </div>

      <details className="exp">
        <summary>Experience detail — how each accident year builds up</summary>
        <div className="body" style={{ maxWidth: '100%' }}>
          <table>
            <thead><tr>
              <th className="num">AY</th><th className="num">Earned</th><th className="num">On-level</th>
              <th className="num">Reported</th><th className="num">LDF</th><th className="num">Ultimate</th>
              <th className="num">Trend ×</th><th className="num">Trended ult.</th><th className="num">Loss ratio</th>
            </tr></thead>
            <tbody>
              {(cur.detail_years ?? baseRes.detail_years ?? []).map(d => (
                <tr key={d.accident_year}>
                  <td className="num">{d.accident_year}</td>
                  <td className="num">{money(d.earned_premium, meta.currency)}</td>
                  <td className="num">{money(d.on_level_earned_premium, meta.currency)}</td>
                  <td className="num">{money(d.reported_incurred, meta.currency)}</td>
                  <td className="num">{d.effective_ldf.toFixed(3)}</td>
                  <td className="num">{money(d.ultimate_loss, meta.currency)}</td>
                  <td className="num">{d.trend_factor.toFixed(3)}</td>
                  <td className="num">{money(d.trended_ultimate, meta.currency)}</td>
                  <td className="num">{pct(d.loss_ratio, 1, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {saveOpen && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="box">
            <h2 style={{ fontSize: 16 }}>Save as scenario</h2>
            <p className="mut" style={{ fontSize: 13, marginTop: 4 }}>A new DRAFT scenario for {prodLabel} · {terrLabel} · {period}. Calculating it records the result and an audit event.</p>
            <label>Scenario name</label>
            <input className="txt" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="ghost" onClick={() => setSaveOpen(false)}>Cancel</button>
              <button className="act" onClick={doSave}>Create scenario</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
