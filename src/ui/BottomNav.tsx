import { dateKey, isNewDay } from '../game/clock';
import {
  GEM_SHOP,
  LEGACY,
  affordableShopItems,
  availableStars,
  availableUpgrades,
  claimableAchievements,
  gemLevel,
  legacyLevel,
  maxTickets,
  pendingStars,
} from '../game/economy';
import { claimableMissions } from '../game/missions';
import { useGame } from '../game/store';

export type TabId = 'city' | 'upgrades' | 'games' | 'ranking' | 'profile';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'city', icon: '🏙️', label: 'Ciudad' },
  { id: 'upgrades', icon: '⬆️', label: 'Mejoras' },
  { id: 'games', icon: '🎮', label: 'Juegos' },
  { id: 'ranking', icon: '🏆', label: 'Ranking' },
  { id: 'profile', icon: '🏅', label: 'Logros' },
];

export function BottomNav({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  const s = useGame((st) => st.s);
  const decree = useGame((st) => st.decree);
  const affordable =
    availableUpgrades(s).filter((u) => s.coins >= u.cost).length +
    affordableShopItems(GEM_SHOP, (id) => gemLevel(s, id), s.gems) +
    affordableShopItems(LEGACY, (id) => legacyLevel(s, id), availableStars(s));
  const today = dateKey(s.lastTick);
  const gamesAlert =
    isNewDay(s.daily.last, today) ||
    isNewDay(s.roads.last, today) ||
    isNewDay(s.parks.last, today) ||
    isNewDay(s.wheelLast, today) ||
    s.tickets >= maxTickets(s);
  const claimable = claimableAchievements(s);
  const missions = claimableMissions(s) + (s.league.prev ? 1 : 0);

  const badge = (id: TabId) => {
    if (id === 'city' && decree && tab !== 'city') return <span className="badge dot">📜</span>;
    if (id === 'city' && missions > 0) return <span className="badge">{missions > 9 ? '9+' : missions}</span>;
    if (id === 'upgrades' && pendingStars(s) > 0 && affordable === 0) return <span className="badge dot">⭐</span>;
    if (id === 'upgrades' && affordable > 0) return <span className="badge">{affordable > 9 ? '9+' : affordable}</span>;
    if (id === 'games' && gamesAlert) return <span className="badge dot">!</span>;
    if (id === 'profile' && claimable > 0) return <span className="badge">{claimable > 9 ? '9+' : claimable}</span>;
    return null;
  };

  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => onTab(t.id)}>
          <span className="nav-icon">
            {t.icon}
            {badge(t.id)}
          </span>
          <span className="nav-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
