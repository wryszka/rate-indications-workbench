import { useState } from 'react';
import { Send } from 'lucide-react';
import { api, GenieAnswer } from '../lib/api';
import { Spin, Explainer } from '../components/common';

type Turn = { q: string; a?: GenieAnswer; error?: string };

const SUGGESTIONS = [
  'Which segments have the largest indicated rate increase?',
  'What is the earned premium by territory for General Liability?',
  'Show the loss ratio by product',
];

export default function Genie() {
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

  const isNum = (v: any) => v !== null && v !== '' && !isNaN(Number(v));

  return (
    <main className="main">
      <h2>Ask the book</h2>
      <p className="mut" style={{ marginTop: 2, fontSize: 13 }}>Natural-language questions over the same governed experience the indications are built on.</p>

      <Explainer>
        Ask a plain-English question about the book — premiums, losses, loss ratios, indications by product or
        territory — and get an answer back, with the query it ran and the rows it returned. It reads the same
        governed data the rest of the workbench uses; it doesn't change anything.
      </Explainer>

      <div className="card">
        <div className="selectrow" style={{ marginBottom: 10 }}>
          <div className="fld" style={{ flex: 1, minWidth: 260 }}>
            <label>Your question</label>
            <input className="txt" style={{ width: '100%' }} value={q} placeholder="e.g. which segments need the biggest increase?"
              onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(q); }} />
          </div>
          <button className="act" onClick={() => ask(q)} disabled={busy || !q.trim()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> Ask {busy && <Spin />}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map(s => <button key={s} className="chipq" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
        </div>
      </div>

      {turns.slice().reverse().map((t, ri) => (
        <div className="card" key={turns.length - 1 - ri}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{t.q}</div>
          {!t.a && !t.error && <div className="mut"><Spin /> thinking…</div>}
          {t.error && <div className="flag high">{t.error}</div>}
          {t.a && (
            <>
              <p style={{ marginTop: 0, color: 'var(--slate2)', fontSize: 14 }}>{t.a.answer}</p>
              {t.a.sql && (
                <details className="exp"><summary>Query it ran</summary>
                  <div className="body"><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'ui-monospace,Menlo,monospace', color: 'var(--slate2)' }}>{t.a.sql}</pre></div>
                </details>
              )}
              {t.a.columns && t.a.rows && t.a.rows.length > 0 && (
                <table style={{ marginTop: 8 }}>
                  <thead><tr>{t.a.columns.map(c => <th key={c} className={isNum(t.a!.rows![0][t.a!.columns!.indexOf(c)]) ? 'num' : ''}>{c}</th>)}</tr></thead>
                  <tbody>
                    {t.a.rows.map((row, i) => (
                      <tr key={i}>{row.map((v, j) => <td key={j} className={isNum(v) ? 'num' : ''}>{String(v ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      ))}
    </main>
  );
}
