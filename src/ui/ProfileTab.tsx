import { useEffect, useState } from 'react';
import { cloudEnabled } from '../firebase';
import { linkGoogle, onAccountChange, renameInLeaderboards, saveCloud, type AccountInfo } from '../game/cloud';
import { claimableAchievements, eraName, totalBuildings } from '../game/economy';
import { fmt } from '../game/format';
import { NAME_MAX } from '../game/names';
import { useGame } from '../game/store';
import { Achievements } from './Achievements';
import { isSoundOn, setSoundOn } from './haptics';

export function ProfileTab() {
  const s = useGame((st) => st.s);
  const [section, setSection] = useState<'ach' | 'profile'>('ach');
  const claimable = claimableAchievements(s);

  return (
    <div className="tab">
      <div className="segmented wide">
        <button className={section === 'ach' ? 'active' : ''} onClick={() => setSection('ach')}>
          🏅 Logros{claimable > 0 && <span className="seg-badge">{claimable}</span>}
        </button>
        <button className={section === 'profile' ? 'active' : ''} onClick={() => setSection('profile')}>
          👤 Perfil
        </button>
      </div>
      {section === 'ach' ? <Achievements /> : <Profile />}
    </div>
  );
}

function Profile() {
  const s = useGame((st) => st.s);
  const setName = useGame((st) => st.setName);
  const toast = useGame((st) => st.toast);
  const [name, setNameInput] = useState(s.name);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [linking, setLinking] = useState(false);
  const [sound, setSound] = useState(isSoundOn());

  useEffect(() => onAccountChange(setAccount), []);

  const saveName = () => {
    const error = setName(name);
    if (error) {
      toast(`⚠️ ${error}`);
      return;
    }
    const s = useGame.getState().s;
    setNameInput(s.name);
    saveCloud(s).catch(() => {});
    renameInLeaderboards(s.name).catch(() => {});
    toast('Nombre guardado');
  };

  const link = async () => {
    setLinking(true);
    try {
      const r = await linkGoogle();
      if (r === 'redirecting') return;
      toast(r === 'linked' ? '✅ Cuenta vinculada con Google' : '✅ Sesión iniciada con tu cuenta de Google');
    } catch (e) {
      console.warn(e);
      toast('No se pudo vincular la cuenta');
    } finally {
      setLinking(false);
    }
  };

  const google = account?.googleEmail != null;

  return (
    <>
      <div className="card">
        <label className="field">
          <span>Nombre en el ranking</span>
          <div className="field-row">
            <input
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
            />
            <button className="btn small primary" onClick={saveName} disabled={!name.trim() || name === s.name}>
              Guardar
            </button>
          </div>
        </label>
      </div>

      <div className="card">
        <b>Cuenta</b>
        {!cloudEnabled && <p className="muted">Firebase no está configurado: el progreso solo se guarda en este dispositivo.</p>}
        {cloudEnabled && google && <p className="muted">Vinculada con Google ({account?.googleEmail}). Tu progreso está a salvo.</p>}
        {cloudEnabled && !google && (
          <>
            <p className="muted">Juegas como invitado. Vincula Google para no perder tu progreso si cambias de móvil.</p>
            <button className="btn primary" onClick={link} disabled={linking || !account}>
              {linking ? 'Vinculando…' : 'Vincular con Google'}
            </button>
          </>
        )}
      </div>

      <div className="card">
        <label className="toggle">
          <span>Sonido y vibración</span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundOn(e.target.checked);
            }}
          />
        </label>
      </div>

      <div className="section-head">
        <h2>Estadísticas</h2>
      </div>
      <div className="stats-grid">
        <div>
          <small>Era</small>
          <b>
            {s.era} · {eraName(s.era)}
          </b>
        </div>
        <div>
          <small>Estrellas</small>
          <b>⭐ {fmt(s.stars)}</b>
        </div>
        <div>
          <small>Total histórico</small>
          <b>{fmt(s.allTimeEarned)}</b>
        </div>
        <div>
          <small>Esta era</small>
          <b>{fmt(s.totalEarned)}</b>
        </div>
        <div>
          <small>Edificios</small>
          <b>{fmt(totalBuildings(s))}</b>
        </div>
        <div>
          <small>Toques</small>
          <b>{fmt(s.taps)}</b>
        </div>
        <div>
          <small>Mejor torre</small>
          <b>{s.stackBest}</b>
        </div>
        <div>
          <small>Mejor fusión</small>
          <b>{fmt(s.mergeBest)}</b>
        </div>
        <div>
          <small>Mejor racha</small>
          <b>🔥 {s.daily.bestStreak}</b>
        </div>
      </div>
    </>
  );
}
