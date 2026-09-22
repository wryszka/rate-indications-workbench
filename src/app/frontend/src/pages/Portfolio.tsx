import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Portfolio as P } from '../lib/api';
import { useMeta, Spin, Explainer } from '../components/common';
import { pct, money, arrow, signClass } from '../lib/format';

export default function Portfolio() {
  const meta = useMeta()!;
  const nav = useNavigate();
  const [period, setPeriod] = useState(meta.periods[0] || 2027);
  const [p, setP] = useState<P | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setLoading(true); api.portfolio(period).then(d => { setP(d); setLoading(false); }); }, [period]);

  const inc = p?.segments.filter(s => s.baseline_indicated > 0.0005).length ?? 0;
  const dec = p?.segments.filter(s => s.baseline_indicated < -0.0005).length ?? 0;

  return (
    <main className="main">
      <h2>Portfolio</h2>
      <p className="mut" style={{ marginTop: 2, fontSize: 13 }}>Approved baseline indication for every product × territory in the book.</p>

      <Explainer>
        Each row is one segment (a product in a territory). The <em>baseline indication</em> is the approved
        rate change the current assumptions imply — positive means rates should rise, negative means they can
        fall. The <em>projected loss ratio</em> is the expected losses as a share of premium; the
        <em> selected rate</em> is what pricing has chosen to file, which may differ from the indication.
        Click a row to open it and work the assumptions.
      </Explainer>

      <div className="selectrow">
        <div className="fld"><label>Indication period</label>
          <select value={period} onChange={e => setPeriod(Number(e.target.value))}>
            {meta.periods.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading || !p ? <div className="card"><Spin /> Loading…</div> : <>
        <div className="tiles">
          <div className="tile"><div className="k">Portfolio indication</div><div className={'v ' + (p.portfolio_indicated >= 0 ? 'warn' : 'pos')}>{pct(p.portfolio_indicated)}</div></div>
          <div className="tile"><div className="k">On-level premium</div><div className="v">{money(p.total_premium, p.currency)}</div></div>
          <div className="tile"><div className="k">Segments</div><div className="v">{p.segments.length}</div></div>
          <div className="tile"><div className="k">Need increase</div><div className="v warn">{inc}</div></div>
          <div className="tile"><div className="k">Need decrease</div><div className="v pos">{dec}</div></div>
        </div>

        <div className="card">
          <table>
            <thead><tr>
              <th>Product</th><th>Territory</th>
              <th className="num">Baseline indication</th><th className="num">Projected LR</th>
              <th className="num">On-level premium</th><th className="num">Selected rate</th>
            </tr></thead>
            <tbody>
              {p.segments.map(s => (
                <tr className="row" key={s.lob_code + s.territory_code}
                  onClick={() => nav(`/indications?lob=${s.lob_code}&territory=${s.territory_code}&period=${period}`)}>
                  <td>{s.lob_label}</td>
                  <td>{s.territory_label}</td>
                  <td className={'num ' + signClass(s.baseline_indicated)} style={{ fontWeight: 600 }}>
                    {arrow(s.baseline_indicated)} {pct(s.baseline_indicated)}
                  </td>
                  <td className="num">{pct(s.projected_loss_ratio, 1, false)}</td>
                  <td className="num">{money(s.on_level_earned_premium, p.currency)}</td>
                  <td className="num">{s.selected_rate_change != null ? pct(s.selected_rate_change) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </main>
  );
}
