import { NavLink, Route, Routes } from 'react-router-dom';
import { Home as HomeIcon, LayoutGrid, TrendingUp, GitCompare, CheckCircle2, BookOpen } from 'lucide-react';
import { MetaProvider } from './components/common';
import Home from './pages/Home';
import Portfolio from './pages/Portfolio';
import Indications from './pages/Indications';
import Scenarios from './pages/Scenarios';
import Review from './pages/Review';
import Learn from './pages/Learn';

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
  { to: '/indications', label: 'Rate Indications', icon: TrendingUp },
  { to: '/scenarios', label: 'Scenarios', icon: GitCompare },
  { to: '/review', label: 'Review & Approve', icon: CheckCircle2 },
  { to: '/learn', label: 'Learn', icon: BookOpen },
];

export default function App() {
  return (
    <MetaProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brickmark"><i /><i /><i /><i /></div>
            <div>
              <div className="bt">Bricksurance</div>
              <div className="bs">Rate Indications</div>
            </div>
          </div>
          <nav className="nav">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => (isActive ? 'active' : '')}>
                <n.icon className="ic" size={16} />{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="side-foot">
            Assumption setting &amp; review
            <br /><span className="pill">DEMO</span>
          </div>
        </aside>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/indications" element={<Indications />} />
          <Route path="/scenarios" element={<Scenarios />} />
          <Route path="/review" element={<Review />} />
          <Route path="/learn" element={<Learn />} />
        </Routes>
      </div>
    </MetaProvider>
  );
}
