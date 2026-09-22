import { useEffect, useState } from 'react';
import { api, Scenario, AuditEvent, ScenarioDetail } from '../lib/api';
import { useMeta, Spin, Explainer } from '../components/common';
import { pct } from '../lib/format';

export default function Review() {
  const meta = useMeta()!;
  const [scns, setScns] = useState<Scenario[]>([]);
  const [openAudit, setOpenAudit] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = () => { setLoading(true); api.scenarios().then(d => { setScns(d.scenarios); setLoading(false); }); };
  useEffect(() => { reload(); }, []);

  const roleFor = (ind: number | null) => {
    if (ind == null) return '—';
    const a = Math.abs(ind);
    return meta.approval_roles.find(r => a >= r.min && a < r.max)?.role ?? meta.approval_roles.at(-1)?.role ?? '—';
  };

  const queue = scns.filter(s => s.status === 'SUBMITTED');
  const act = async (id: string, decision: 'approve' | 'reject') => {
    await api.review(id, decision, decision === 'approve' ? 'Basis reviewed and approved.' : 'Returned for revision.');
    reload();
  };

  return (
    <main className="main">
      <h2>Review &amp; Approve</h2>
      <p className="mut" style={{ marginTop: 2, fontSize: 13 }}>Governed sign-off — routed by the size of the change, with a full append-only audit trail.</p>

      <Explainer>
        Scenarios submitted for review appear here. Who must approve depends on the size of the indicated
        change (routing shown per row). Approving or rejecting is itself an audited event. The audit trail
        for any scenario shows every action, who did it and when — and the recorded result carries the exact
        method version and data version, so any number can be reproduced later.
      </Explainer>

      <div className="card">
        <div className="eyebrow">Approval routing</div>
        <div className="lin">
          {meta.approval_roles.map((r, i) => (
            <span key={i} className="node">|change| {(r.min * 100).toFixed(0)}–{r.max >= 90 ? '∞' : (r.max * 100).toFixed(0)}% → <strong>{r.role}</strong></span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">Review queue {queue.length > 0 && <span className="chip differs" style={{ marginLeft: 6 }}>{queue.length}</span>}</div>
        {loading ? <Spin /> : queue.length === 0 ? <p className="mut" style={{ fontSize: 13 }}>Nothing awaiting review. Submit a scenario from the Scenarios page.</p> : (
          <table>
            <thead><tr><th>Scenario</th><th>Segment</th><th className="num">Indicated</th><th className="num">Selected</th><th>Approver</th><th></th></tr></thead>
            <tbody>
              {queue.map(s => (
                <tr key={s.scenario_id}>
                  <td>{s.scenario_name}</td>
                  <td className="mut">{s.lob_code} · {s.territory_code} · {s.indication_period}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{s.indicated_rate_change != null ? pct(s.indicated_rate_change) : '—'}</td>
                  <td className="num">{s.selected_rate_change != null ? pct(s.selected_rate_change) : '—'}</td>
                  <td><span className="chip plain">{roleFor(s.indicated_rate_change)}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="act" onClick={() => act(s.scenario_id, 'approve')}>Approve</button>
                    <button className="ghost" onClick={() => act(s.scenario_id, 'reject')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">Audit trail</div>
        <div className="selectrow">
          <div className="fld"><label>Scenario</label>
            <select value={openAudit ?? ''} onChange={e => setOpenAudit(e.target.value || null)}>
              <option value="">Select a scenario…</option>
              {scns.map(s => <option key={s.scenario_id} value={s.scenario_id}>{s.scenario_name} — {s.lob_code}/{s.territory_code} ({s.status})</option>)}
            </select>
          </div>
        </div>
        {openAudit && <AuditTrail id={openAudit} />}
      </div>
    </main>
  );
}

function AuditTrail({ id }: { id: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [detail, setDetail] = useState<ScenarioDetail | null>(null);
  useEffect(() => { api.audit(id).then(d => setEvents(d.events)); api.scenario(id).then(setDetail); }, [id]);
  if (!events) return <Spin />;
  return (
    <>
      {detail?.result && (
        <div className="banner" style={{ marginBottom: 12 }}>
          <span className="gov">reproducible</span> &nbsp; Recorded result: indicated <strong>{pct(detail.result.indicated_rate_change)}</strong> ·
          calc version <strong>{detail.result.calc_version}</strong> · data version <strong>{detail.result.experience_version}</strong> ·
          by {detail.result.calculated_by}
        </div>
      )}
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Status</th><th>Note</th></tr></thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="mut" style={{ fontSize: 12 }}>{String(e.log_ts).replace('T', ' ').slice(0, 19)}</td>
              <td><span className="chip plain">{e.action}</span></td>
              <td className="mut">{e.actor}</td>
              <td className="mut">{e.from_status && e.to_status ? `${e.from_status} → ${e.to_status}` : e.to_status || ''}</td>
              <td className="mut" style={{ fontSize: 12 }}>{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
