import { useState, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts';

// ─── HELPERS ───────────────────────────────────────────────
const fmt = (n) => {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
};
const fmtN = (n) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
};
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const toDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── SEEDED RNG ────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── MOCK DATA GENERATOR ──────────────────────────────────
function generateMockData(clients, team) {
  const rng = mulberry32(42);
  const rand = (min, max) => min + rng() * (max - min);
  const randInt = (min, max) => Math.round(rand(min, max));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const records = [];
  const now = new Date();
  const startDate = new Date(2025, 5, 1);

  const setters = team.filter(t => t.role === 'setter');
  const closers = team.filter(t => t.role === 'closer');

  for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
    const ds = dateStr(d);
    if (d.getDay() === 0) continue;

    for (const client of clients) {
      const isTyson = client.name === 'Tyson Sonnek';
      // Tyson: 174 calls/mo ÷ 26 days ≈ 6.7/day, ~$75k rev/mo
      // Keith: ~96 calls/mo, ~$41k rev/mo
      const dailyBooked = isTyson ? randInt(5, 8) : randInt(3, 5);
      const dailyLeads = randInt(Math.round(dailyBooked * 2.6), Math.round(dailyBooked * 3.4));
      const dailyConvos = randInt(Math.round(dailyLeads * 0.42), Math.round(dailyLeads * 0.55));
      const dailyAdSpend = randInt(isTyson ? 720 : 440, isTyson ? 980 : 600);

      // Create a keyed accumulator for each setter-closer pair
      const pairMap = {};
      const key = (sid, cid) => `${sid}|${cid}`;
      for (const s of setters) for (const c of closers) {
        pairMap[key(s.id, c.id)] = {
          setterId: s.id, closerId: c.id,
          leads: 0, conversations: 0, callsBooked: 0,
          showed: 0, noShow: 0, won: 0, lost: 0,
          revenue: 0, cashCollected: 0,
          objections: { Money: 0, Time: 0, Fear: 0, 'Spouse/Partner': 0, 'Not a fit': 0, None: 0 },
          programs: [], subsSold: 0,
          retentionAttempts: 0, retained: 0,
        };
      }

      // Distribute leads among setters (weighted random)
      const setterWeights = setters.map(() => rand(0.7, 1.3));
      const swTotal = setterWeights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < dailyLeads; i++) {
        let r = rng() * swTotal, si = 0;
        for (; si < setters.length - 1; si++) { r -= setterWeights[si]; if (r <= 0) break; }
        const cid = pick(closers).id;
        pairMap[key(setters[si].id, cid)].leads++;
      }
      for (let i = 0; i < dailyConvos; i++) {
        let r = rng() * swTotal, si = 0;
        for (; si < setters.length - 1; si++) { r -= setterWeights[si]; if (r <= 0) break; }
        const cid = pick(closers).id;
        pairMap[key(setters[si].id, cid)].conversations++;
      }

      // Model each booked call individually
      for (let i = 0; i < dailyBooked; i++) {
        // Assign setter & closer
        let r = rng() * swTotal, si = 0;
        for (; si < setters.length - 1; si++) { r -= setterWeights[si]; if (r <= 0) break; }
        const setter = setters[si];
        const closer = pick(closers);
        const p = pairMap[key(setter.id, closer.id)];

        p.callsBooked++;

        // Show: 65-75%
        const didShow = rng() < rand(0.65, 0.75);
        if (!didShow) { p.noShow++; continue; }
        p.showed++;

        // Close: 46-54%
        const didClose = rng() < rand(0.46, 0.54);
        if (!didClose) {
          p.lost++;
          const obj = rng();
          if (obj < 0.32) p.objections.Money++;
          else if (obj < 0.52) p.objections.Time++;
          else if (obj < 0.68) p.objections.Fear++;
          else if (obj < 0.80) p.objections['Spouse/Partner']++;
          else if (obj < 0.90) p.objections['Not a fit']++;
          else p.objections.None++;
          continue;
        }
        p.won++;

        // Program type
        const prog = rng();
        const months = prog < 0.25 ? 3 : prog < 0.70 ? 6 : 12;
        p.programs.push(months);
        const price = months === 3 ? 1497 : months === 6 ? 2497 : 3997;
        p.revenue += price;
        // Cash collected: 3mo = full, 6mo = 60% full / 40% partial, 12mo = 40% full / 60% partial
        if (months === 3) p.cashCollected += 1497;
        else if (months === 6) p.cashCollected += (rng() < 0.6 ? 2497 : 1297);
        else p.cashCollected += (rng() < 0.4 ? 3997 : 1797);
      }

      // Subs sold from DMs (not from calls)
      for (const s of setters) {
        if (rng() < 0.18) {
          const cid = pick(closers).id;
          pairMap[key(s.id, cid)].subsSold++;
        }
      }

      // Retention attempts
      const retAttempts = rng() < 0.15 ? randInt(1, 3) : 0;
      for (let i = 0; i < retAttempts; i++) {
        const cid = pick(closers).id;
        const sid = pick(setters).id;
        const p = pairMap[key(sid, cid)];
        p.retentionAttempts++;
        if (rng() < 0.40) p.retained++;
      }

      // Emit records for pairs that have any activity
      for (const p of Object.values(pairMap)) {
        if (p.leads === 0 && p.callsBooked === 0 && p.subsSold === 0 && p.retentionAttempts === 0) continue;
        records.push({
          date: ds,
          clientId: client.id,
          setterId: p.setterId,
          closerId: p.closerId,
          leads: p.leads,
          conversations: p.conversations,
          callsBooked: p.callsBooked,
          showed: p.showed,
          noShow: p.noShow,
          won: p.won,
          lost: p.lost,
          revenue: p.revenue,
          cashCollected: p.cashCollected,
          adSpend: Math.round(dailyAdSpend / (setters.length * closers.length)),
          objections: p.objections,
          programs: p.programs,
          subsSold: p.subsSold,
          subRevenue: p.subsSold * 50,
          retentionAttempts: p.retentionAttempts,
          retained: p.retained,
          retentionRevenue: p.retained * 197,
        });
      }
    }
  }
  return records;
}

// ─── INITIAL STATE ─────────────────────────────────────────
const initialClients = [
  { id: 'c1', name: 'Tyson Sonnek', addedDate: '2025-06-01' },
  { id: 'c2', name: 'Keith Holland', addedDate: '2025-06-01' },
];

const initialTeam = [
  { id: 's1', name: 'Amara', role: 'setter', addedDate: '2025-06-01' },
  { id: 's2', name: 'Debbie', role: 'setter', addedDate: '2025-06-01' },
  { id: 's3', name: 'Gideon', role: 'setter', addedDate: '2025-06-01' },
  { id: 's4', name: 'Kelechi', role: 'setter', addedDate: '2025-06-01' },
  { id: 'cl1', name: 'Broz', role: 'closer', addedDate: '2025-06-01' },
  { id: 'cl2', name: 'Will', role: 'closer', addedDate: '2025-06-01' },
];

const ACCENT = '#7dd3fc';
const OBJECTION_COLORS = { Money: '#f87171', Time: '#fbbf24', Fear: '#c084fc', 'Spouse/Partner': '#fb923c', 'Not a fit': '#94a3b8', None: '#4ade80' };

// ─── MAIN APP ──────────────────────────────────────────────
export default function App() {
  const [clients, setClients] = useState(initialClients);
  const [team, setTeam] = useState(initialTeam);
  const [activeTab, setActiveTab] = useState('clients');
  const [selectedClient, setSelectedClient] = useState('all');
  const [selectedMember, setSelectedMember] = useState(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const [dateRange, setDateRange] = useState({ start: monthStart, end: dateStr(now) });
  const [datePreset, setDatePreset] = useState('thisMonth');

  const data = useMemo(() => generateMockData(clients, team), [clients, team]);

  const filtered = useMemo(() => {
    const s = toDate(dateRange.start);
    const e = toDate(dateRange.end);
    e.setHours(23, 59, 59);
    return data.filter(r => {
      const rd = toDate(r.date);
      if (rd < s || rd > e) return false;
      if (activeTab === 'clients' && selectedClient !== 'all' && r.clientId !== selectedClient) return false;
      if (activeTab === 'team' && selectedMember && r.setterId !== selectedMember && r.closerId !== selectedMember) return false;
      return true;
    });
  }, [data, dateRange, activeTab, selectedClient, selectedMember]);

  const metrics = useMemo(() => {
    const m = {
      revenue: 0, cashCollected: 0, adSpend: 0,
      leads: 0, conversations: 0, callsBooked: 0, showed: 0, won: 0, lost: 0, noShow: 0,
      subsSold: 0, subRevenue: 0, retentionAttempts: 0, retained: 0, retentionRevenue: 0,
      objections: { Money: 0, Time: 0, Fear: 0, 'Spouse/Partner': 0, 'Not a fit': 0, None: 0 },
      programs: [],
    };
    for (const r of filtered) {
      m.revenue += r.revenue;
      m.cashCollected += r.cashCollected;
      m.adSpend += r.adSpend;
      m.leads += r.leads;
      m.conversations += r.conversations;
      m.callsBooked += r.callsBooked;
      m.showed += r.showed;
      m.won += r.won;
      m.lost += r.lost;
      m.noShow += r.noShow;
      m.subsSold += r.subsSold;
      m.subRevenue += r.subRevenue;
      m.retentionAttempts += r.retentionAttempts;
      m.retained += r.retained;
      m.retentionRevenue += r.retentionRevenue;
      for (const [k, v] of Object.entries(r.objections)) m.objections[k] += v;
      m.programs.push(...r.programs);
    }
    m.aov = m.won > 0 ? m.revenue / m.won : 0;
    m.cpl = m.leads > 0 ? m.adSpend / m.leads : 0;
    m.cpbc = m.callsBooked > 0 ? m.adSpend / m.callsBooked : 0;
    m.cpc = m.won > 0 ? m.adSpend / m.won : 0;
    m.showRate = m.callsBooked > 0 ? m.showed / m.callsBooked : 0;
    m.closeRate = m.showed > 0 ? m.won / m.showed : 0;
    m.subMRR = m.subsSold * 50;
    m.retentionMRR = m.retained * 197;
    m.totalMRR = m.subMRR + m.retentionMRR;
    m.retentionRate = m.retentionAttempts > 0 ? m.retained / m.retentionAttempts : 0;
    return m;
  }, [filtered]);

  const setterMetrics = useMemo(() => {
    const setters = team.filter(t => t.role === 'setter');
    return setters.map(s => {
      const recs = filtered.filter(r => r.setterId === s.id);
      const leads = recs.reduce((a, r) => a + r.leads, 0);
      const booked = recs.reduce((a, r) => a + r.callsBooked, 0);
      const showed = recs.reduce((a, r) => a + r.showed, 0);
      const won = recs.reduce((a, r) => a + r.won, 0);
      const revenue = recs.reduce((a, r) => a + r.revenue, 0);
      const subsSold = recs.reduce((a, r) => a + r.subsSold, 0);
      return {
        ...s,
        leads,
        callsSourced: booked,
        bookingRate: leads > 0 ? booked / leads : 0,
        showRate: booked > 0 ? showed / booked : 0,
        closeRate: showed > 0 ? won / showed : 0,
        subsSold,
        revenueSourced: revenue,
      };
    });
  }, [filtered, team]);

  const closerMetrics = useMemo(() => {
    const closers = team.filter(t => t.role === 'closer');
    return closers.map(c => {
      const recs = filtered.filter(r => r.closerId === c.id);
      const taken = recs.reduce((a, r) => a + r.callsBooked, 0);
      const showed = recs.reduce((a, r) => a + r.showed, 0);
      const won = recs.reduce((a, r) => a + r.won, 0);
      const lost = recs.reduce((a, r) => a + r.lost, 0);
      const noShow = recs.reduce((a, r) => a + r.noShow, 0);
      const revenue = recs.reduce((a, r) => a + r.revenue, 0);
      const objections = { Money: 0, Time: 0, Fear: 0, 'Spouse/Partner': 0, 'Not a fit': 0, None: 0 };
      for (const r of recs) for (const [k, v] of Object.entries(r.objections)) objections[k] += v;
      const topObj = Object.entries(objections).sort((a, b) => b[1] - a[1])[0];
      return {
        ...c,
        callsTaken: taken,
        won, lost, noShow,
        showRate: taken > 0 ? showed / taken : 0,
        closeRate: showed > 0 ? won / showed : 0,
        aov: won > 0 ? revenue / won : 0,
        totalRevenue: revenue,
        topObjection: topObj ? topObj[0] : 'N/A',
        objections,
      };
    });
  }, [filtered, team]);

  const handlePreset = useCallback((preset) => {
    setDatePreset(preset);
    const n = new Date();
    if (preset === 'thisMonth') {
      setDateRange({ start: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`, end: dateStr(n) });
    } else if (preset === 'lastMonth') {
      const lm = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      const lme = new Date(n.getFullYear(), n.getMonth(), 0);
      setDateRange({ start: dateStr(lm), end: dateStr(lme) });
    } else {
      setDateRange({ start: '2025-06-01', end: dateStr(n) });
    }
  }, []);

  const memberDetail = selectedMember ? team.find(t => t.id === selectedMember) : null;
  const memberIsSetter = memberDetail?.role === 'setter';
  const memberStats = memberIsSetter
    ? setterMetrics.find(s => s.id === selectedMember)
    : closerMetrics.find(c => c.id === selectedMember);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-56 flex-shrink-0 border-r border-[#3a3a3a] bg-[#242424] flex flex-col">
        <div className="p-4 border-b border-[#3a3a3a]">
          <h1 className="text-base font-semibold text-[#e5e5e5] tracking-tight">Core Shift LLC</h1>
          <p className="text-xs text-[#666] mt-0.5">Sales Operations</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <button
            onClick={() => { setActiveTab('clients'); setSelectedMember(null); }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${activeTab === 'clients' ? 'bg-[rgba(125,211,252,0.1)] text-[#7dd3fc] border border-[rgba(125,211,252,0.2)]' : 'text-[#999] hover:bg-[#333] hover:text-[#e5e5e5] border border-transparent'}`}
          >
            Agency Clients
          </button>
          <button
            onClick={() => { setActiveTab('team'); setSelectedClient('all'); }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${activeTab === 'team' ? 'bg-[rgba(125,211,252,0.1)] text-[#7dd3fc] border border-[rgba(125,211,252,0.2)]' : 'text-[#999] hover:bg-[#333] hover:text-[#e5e5e5] border border-transparent'}`}
          >
            Team
          </button>
        </nav>

        <div className="p-3 space-y-2 border-t border-[#3a3a3a]">
          <button onClick={() => setShowAddClient(true)} className="w-full px-3 py-2 text-xs text-[#999] border border-[#3a3a3a] rounded-md hover:border-[#7dd3fc] hover:text-[#7dd3fc] transition-colors">
            + Add Client
          </button>
          <button onClick={() => setShowAddMember(true)} className="w-full px-3 py-2 text-xs text-[#999] border border-[#3a3a3a] rounded-md hover:border-[#7dd3fc] hover:text-[#7dd3fc] transition-colors">
            + Add Team Member
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 overflow-y-auto bg-[#1a1a1a]">
        {/* HEADER BAR */}
        <header className="sticky top-0 z-10 bg-[#1a1a1a]/95 backdrop-blur border-b border-[#3a3a3a] px-6 py-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              {activeTab === 'clients' && (
                <select
                  value={selectedClient}
                  onChange={e => setSelectedClient(e.target.value)}
                  className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-3 py-1.5 text-sm text-[#e5e5e5] focus:outline-none focus:border-[#7dd3fc] appearance-none cursor-pointer pr-8"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                >
                  <option value="all">All Clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {activeTab === 'team' && selectedMember && (
                <button onClick={() => setSelectedMember(null)} className="text-sm text-[#7dd3fc] hover:underline">
                  &larr; All Team
                </button>
              )}
              <h2 className="text-sm font-medium text-[#e5e5e5]">
                {activeTab === 'clients'
                  ? (selectedClient === 'all' ? 'All Clients Summary' : clients.find(c => c.id === selectedClient)?.name)
                  : selectedMember ? memberDetail?.name : 'Team Overview'}
              </h2>
            </div>

            {/* DATE RANGE */}
            <div className="flex items-center gap-2 flex-wrap">
              {['thisMonth', 'lastMonth', 'allTime'].map(p => (
                <button
                  key={p}
                  onClick={() => handlePreset(p)}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${datePreset === p ? 'border-[#7dd3fc] text-[#7dd3fc] bg-[rgba(125,211,252,0.1)]' : 'border-[#3a3a3a] text-[#999] hover:border-[rgba(125,211,252,0.5)]'}`}
                >
                  {p === 'thisMonth' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : 'All Time'}
                </button>
              ))}
              <div className="flex items-center gap-1.5 ml-2">
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={e => { setDateRange(r => ({ ...r, start: e.target.value })); setDatePreset(''); }}
                  className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-xs text-[#e5e5e5] focus:outline-none focus:border-[#7dd3fc]"
                />
                <span className="text-[#666] text-xs">to</span>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={e => { setDateRange(r => ({ ...r, end: e.target.value })); setDatePreset(''); }}
                  className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-md px-2 py-1 text-xs text-[#e5e5e5] focus:outline-none focus:border-[#7dd3fc]"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="p-6 space-y-6">
          {activeTab === 'clients' && !selectedMember && <ClientsView metrics={metrics} filtered={filtered} setterMetrics={setterMetrics} closerMetrics={closerMetrics} />}
          {activeTab === 'team' && !selectedMember && <TeamView setterMetrics={setterMetrics} closerMetrics={closerMetrics} onSelect={setSelectedMember} />}
          {activeTab === 'team' && selectedMember && memberStats && (
            memberIsSetter
              ? <SetterDetail stats={memberStats} />
              : <CloserDetail stats={memberStats} />
          )}
        </div>
      </main>

      {/* MODALS */}
      {showAddClient && <AddClientModal onClose={() => setShowAddClient(false)} onAdd={(name) => { setClients(prev => [...prev, { id: `c${Date.now()}`, name, addedDate: dateStr(new Date()) }]); setShowAddClient(false); }} />}
      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onAdd={(name, role) => { setTeam(prev => [...prev, { id: `${role[0]}${Date.now()}`, name, role, addedDate: dateStr(new Date()) }]); setShowAddMember(false); }} />}
    </div>
  );
}

// ─── CARD COMPONENT ────────────────────────────────────────
function Card({ label, value, sub, accent }) {
  return (
    <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
      <p className="text-xs text-[#666] mb-1">{label}</p>
      <p className={`text-xl font-semibold ${accent ? 'text-[#7dd3fc]' : 'text-[#e5e5e5]'}`}>{value}</p>
      {sub && <p className="text-xs text-[#666] mt-1">{sub}</p>}
    </div>
  );
}

// ─── CLIENTS VIEW ──────────────────────────────────────────
function ClientsView({ metrics, filtered, setterMetrics, closerMetrics }) {
  const m = metrics;

  const funnelData = [
    { name: 'Leads', value: m.leads, fill: '#7dd3fc' },
    { name: 'Conversations', value: m.conversations, fill: '#38bdf8' },
    { name: 'Calls Booked', value: m.callsBooked, fill: '#0ea5e9' },
    { name: 'Showed', value: m.showed, fill: '#0284c7' },
    { name: 'Closed', value: m.won, fill: '#0369a1' },
    { name: 'Retained', value: m.retained, fill: '#075985' },
  ];

  const objData = Object.entries(m.objections).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const dailyMap = {};
  for (const r of filtered) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { date: r.date, revenue: 0, cash: 0 };
    dailyMap[r.date].revenue += r.revenue;
    dailyMap[r.date].cash += r.cashCollected;
  }
  const trend = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      {/* KPI ROW 1 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card label="Total Revenue" value={fmt(m.revenue)} accent />
        <Card label="Cash Collected" value={fmt(m.cashCollected)} />
        <Card label="AOV" value={fmt(m.aov)} />
        <Card label="Ad Spend" value={fmt(m.adSpend)} />
        <Card label="Cost Per Lead" value={fmt(m.cpl)} />
        <Card label="Cost Per Client" value={fmt(m.cpc)} />
      </div>

      {/* KPI ROW 2 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card label="Calls Booked" value={fmtN(m.callsBooked)} />
        <Card label="Show Rate" value={pct(m.showRate)} />
        <Card label="Close Rate" value={pct(m.closeRate)} accent />
        <Card label="Sub MRR" value={fmt(m.subMRR)} sub={`${m.subsSold} subs @ $50`} />
        <Card label="Retention MRR" value={fmt(m.retentionMRR)} sub={`${m.retained} @ $197`} />
        <Card label="Total MRR" value={fmt(m.totalMRR)} accent />
      </div>

      {/* KPI ROW 3 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Cost Per Booked Call" value={fmt(m.cpbc)} />
        <Card label="Retention Rate" value={pct(m.retentionRate)} />
        <Card label="Retention Attempts" value={fmtN(m.retentionAttempts)} />
        <Card label="Leads Generated" value={fmtN(m.leads)} />
      </div>

      {/* CHARTS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend */}
        <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
          <h3 className="text-sm font-medium text-[#999] mb-4">Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#666' }} tickFormatter={v => v.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#666' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8, fontSize: 12 }} formatter={v => [`$${v.toLocaleString()}`, '']} />
              <Line type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="cash" stroke="#4ade80" strokeWidth={1.5} dot={false} name="Cash" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Conversion Funnel */}
        <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
          <h3 className="text-sm font-medium text-[#999] mb-4">Conversion Funnel</h3>
          <div className="space-y-2">
            {funnelData.map((item, i) => {
              const maxVal = funnelData[0].value;
              const widthPct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs text-[#666] w-24 text-right">{item.name}</span>
                  <div className="flex-1 h-7 bg-[#1a1a1a] rounded relative overflow-hidden">
                    <div
                      className="h-full rounded transition-all duration-500"
                      style={{ width: `${Math.max(widthPct, 2)}%`, backgroundColor: item.fill }}
                    />
                  </div>
                  <span className="text-xs text-[#e5e5e5] w-14 text-right font-medium">{item.value.toLocaleString()}</span>
                  {i > 0 && (
                    <span className="text-xs text-[#666] w-12 text-right">
                      {funnelData[i-1].value > 0 ? pct(item.value / funnelData[i-1].value) : '0%'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* OBJECTIONS + SETTER TABLE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
          <h3 className="text-sm font-medium text-[#999] mb-4">Objection Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={objData} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10, fill: '#666' }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#999' }} width={90} />
              <Tooltip contentStyle={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {objData.map((entry) => (
                  <Cell key={entry.name} fill={OBJECTION_COLORS[entry.name] || ACCENT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
          <h3 className="text-sm font-medium text-[#999] mb-4">Setter Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#666] border-b border-[#3a3a3a]">
                  <th className="text-left py-2 px-2 font-medium">Name</th>
                  <th className="text-right py-2 px-2 font-medium">Calls</th>
                  <th className="text-right py-2 px-2 font-medium">Book %</th>
                  <th className="text-right py-2 px-2 font-medium">Show %</th>
                  <th className="text-right py-2 px-2 font-medium">Close %</th>
                  <th className="text-right py-2 px-2 font-medium">Subs</th>
                  <th className="text-right py-2 px-2 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {setterMetrics.map(s => (
                  <tr key={s.id} className="border-b border-[#3a3a3a]/50 hover:bg-[#333] transition-colors">
                    <td className="py-2 px-2 text-[#e5e5e5]">{s.name}</td>
                    <td className="py-2 px-2 text-right text-[#999]">{s.callsSourced}</td>
                    <td className="py-2 px-2 text-right text-[#999]">{pct(s.bookingRate)}</td>
                    <td className="py-2 px-2 text-right text-[#999]">{pct(s.showRate)}</td>
                    <td className="py-2 px-2 text-right text-[#999]">{pct(s.closeRate)}</td>
                    <td className="py-2 px-2 text-right text-[#999]">{s.subsSold}</td>
                    <td className="py-2 px-2 text-right text-[#7dd3fc] font-medium">{fmt(s.revenueSourced)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* CLOSER TABLE */}
      <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
        <h3 className="text-sm font-medium text-[#999] mb-4">Closer Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#666] border-b border-[#3a3a3a]">
                <th className="text-left py-2 px-2 font-medium">Name</th>
                <th className="text-right py-2 px-2 font-medium">Taken</th>
                <th className="text-right py-2 px-2 font-medium">Won</th>
                <th className="text-right py-2 px-2 font-medium">Lost</th>
                <th className="text-right py-2 px-2 font-medium">No Show</th>
                <th className="text-right py-2 px-2 font-medium">Show %</th>
                <th className="text-right py-2 px-2 font-medium">Close %</th>
                <th className="text-right py-2 px-2 font-medium">AOV</th>
                <th className="text-right py-2 px-2 font-medium">Revenue</th>
                <th className="text-right py-2 px-2 font-medium">Top Objection</th>
              </tr>
            </thead>
            <tbody>
              {closerMetrics.map(c => (
                <tr key={c.id} className="border-b border-[#3a3a3a]/50 hover:bg-[#333] transition-colors">
                  <td className="py-2 px-2 text-[#e5e5e5]">{c.name}</td>
                  <td className="py-2 px-2 text-right text-[#999]">{c.callsTaken}</td>
                  <td className="py-2 px-2 text-right text-[#4ade80]">{c.won}</td>
                  <td className="py-2 px-2 text-right text-[#f87171]">{c.lost}</td>
                  <td className="py-2 px-2 text-right text-[#666]">{c.noShow}</td>
                  <td className="py-2 px-2 text-right text-[#999]">{pct(c.showRate)}</td>
                  <td className="py-2 px-2 text-right text-[#999]">{pct(c.closeRate)}</td>
                  <td className="py-2 px-2 text-right text-[#999]">{fmt(c.aov)}</td>
                  <td className="py-2 px-2 text-right text-[#7dd3fc] font-medium">{fmt(c.totalRevenue)}</td>
                  <td className="py-2 px-2 text-right text-[#fbbf24]">{c.topObjection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── TEAM VIEW ─────────────────────────────────────────────
function TeamView({ setterMetrics, closerMetrics, onSelect }) {
  return (
    <>
      <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
        <h3 className="text-sm font-medium text-[#999] mb-4">Setters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {setterMetrics.map(s => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="text-left border border-[#3a3a3a] rounded-lg p-4 hover:border-[rgba(125,211,252,0.5)] transition-colors bg-[#1a1a1a]"
            >
              <p className="text-sm font-medium text-[#e5e5e5] mb-2">{s.name}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Calls Sourced</span>
                  <span className="text-[#999]">{s.callsSourced}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Booking Rate</span>
                  <span className="text-[#999]">{pct(s.bookingRate)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Revenue</span>
                  <span className="text-[#7dd3fc] font-medium">{fmt(s.revenueSourced)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
        <h3 className="text-sm font-medium text-[#999] mb-4">Closers</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {closerMetrics.map(c => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="text-left border border-[#3a3a3a] rounded-lg p-4 hover:border-[rgba(125,211,252,0.5)] transition-colors bg-[#1a1a1a]"
            >
              <p className="text-sm font-medium text-[#e5e5e5] mb-2">{c.name}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Calls Taken</span>
                  <span className="text-[#999]">{c.callsTaken}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Close Rate</span>
                  <span className="text-[#999]">{pct(c.closeRate)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#666]">Revenue</span>
                  <span className="text-[#7dd3fc] font-medium">{fmt(c.totalRevenue)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── SETTER DETAIL ─────────────────────────────────────────
function SetterDetail({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      <Card label="Leads" value={fmtN(stats.leads)} />
      <Card label="Calls Sourced" value={fmtN(stats.callsSourced)} />
      <Card label="Booking Rate" value={pct(stats.bookingRate)} />
      <Card label="Show Rate" value={pct(stats.showRate)} />
      <Card label="Close Rate" value={pct(stats.closeRate)} />
      <Card label="Subs Sold" value={stats.subsSold} />
      <Card label="Revenue Sourced" value={fmt(stats.revenueSourced)} accent />
    </div>
  );
}

// ─── CLOSER DETAIL ─────────────────────────────────────────
function CloserDetail({ stats }) {
  const objData = Object.entries(stats.objections).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <Card label="Calls Taken" value={fmtN(stats.callsTaken)} />
        <Card label="Won" value={stats.won} />
        <Card label="Lost" value={stats.lost} />
        <Card label="No Show" value={stats.noShow} />
        <Card label="Show Rate" value={pct(stats.showRate)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Close Rate" value={pct(stats.closeRate)} accent />
        <Card label="AOV" value={fmt(stats.aov)} />
        <Card label="Total Revenue" value={fmt(stats.totalRevenue)} accent />
        <Card label="Top Objection" value={stats.topObjection} />
      </div>

      <div className="border border-[#3a3a3a] rounded-lg p-4 bg-[#2a2a2a]">
        <h3 className="text-sm font-medium text-[#999] mb-4">Objection Breakdown</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={objData} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 10, fill: '#666' }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#999' }} width={90} />
            <Tooltip contentStyle={{ backgroundColor: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {objData.map((entry) => (
                <Cell key={entry.name} fill={OBJECTION_COLORS[entry.name] || ACCENT} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// ─── ADD CLIENT MODAL ──────────────────────────────────────
function AddClientModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-6 w-96" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium text-[#e5e5e5] mb-4">Add New Client</h3>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Client name"
          className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#666] focus:outline-none focus:border-[#7dd3fc] mb-4"
          onKeyDown={e => e.key === 'Enter' && name.trim() && onAdd(name.trim())}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-[#999] border border-[#3a3a3a] rounded-md hover:bg-[#333]">Cancel</button>
          <button onClick={() => name.trim() && onAdd(name.trim())} className="px-4 py-1.5 text-xs text-[#1a1a1a] bg-[#7dd3fc] rounded-md hover:bg-[#38bdf8] font-medium">Add Client</button>
        </div>
      </div>
    </div>
  );
}

// ─── ADD MEMBER MODAL ──────────────────────────────────────
function AddMemberModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('setter');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-6 w-96" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-medium text-[#e5e5e5] mb-4">Add Team Member</h3>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] placeholder-[#666] focus:outline-none focus:border-[#7dd3fc] mb-3"
        />
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-md px-3 py-2 text-sm text-[#e5e5e5] focus:outline-none focus:border-[#7dd3fc] mb-4"
        >
          <option value="setter">Setter</option>
          <option value="closer">Closer</option>
        </select>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-[#999] border border-[#3a3a3a] rounded-md hover:bg-[#333]">Cancel</button>
          <button onClick={() => name.trim() && onAdd(name.trim(), role)} className="px-4 py-1.5 text-xs text-[#1a1a1a] bg-[#7dd3fc] rounded-md hover:bg-[#38bdf8] font-medium">Add Member</button>
        </div>
      </div>
    </div>
  );
}
