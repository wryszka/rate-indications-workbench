import { useEffect, useState } from 'react';
import { api, LearnCard } from '../lib/api';
import { useMeta, Spin } from '../components/common';
import { disclaimerLong } from '../lib/brand';

export default function Learn() {
  const meta = useMeta()!;
  const [cards, setCards] = useState<LearnCard[] | null>(null);
  useEffect(() => { api.learn().then(d => setCards(d.cards)); }, []);
  if (!cards) return <main className="main"><h2>Learn</h2><div className="card"><Spin /></div></main>;

  const groups = [...new Set(cards.map(c => c.group))];

  return (
    <main className="main">
      <h2>Learn — how it works</h2>
      <p className="mut" style={{ marginTop: 2, fontSize: 13 }}>Every step of the workflow, and the governed object behind it. Behind the scenes is a click, never a hand-wave.</p>

      <div className="card">
        <div className="jflow">
          {groups.map(g => (
            <div className="jgroup" key={g}>
              <div className="gl">{g}</div>
              {cards.filter(c => c.group === g).map(c => (
                <div key={c.n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '10px 0' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{c.n}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.activity}</div>
                    <div className="mut" style={{ fontSize: 12.5, margin: '3px 0 5px' }}>{c.how}</div>
                    {c.links.map((l, i) => <span key={i} className="chip plain" style={{ marginRight: 5 }}>{l.label}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="banner"><strong>About this demo.</strong> {disclaimerLong(meta.entity_name).replace('About this demo. ', '')}</div>
    </main>
  );
}
