import { useEffect, useState } from 'react';
import { now } from '../game/clock';
import { CENTER, seasonOf, standings, type Tile } from '../game/conquest';
import { fetchWorldOnce, fetchWorlds, removeTile, type WorldData } from '../game/conquestCloud';
import { useGame } from '../game/store';
import { Modal } from '../ui/Modal';

// Panel de administración → Conquista: mundos de la semana, clasificación y moderación de territorios.

const errorText = (e: unknown) =>
  (e as { code?: string })?.code === 'permission-denied' ? 'Sin permiso. Entra con la cuenta de Google de administrador.' : 'No se pudo cargar. Revisa tu conexión.';

export function ConquestAdmin() {
  const current = seasonOf(now()).week;
  const [y, m, d] = current.split('-').map(Number);
  const prevDate = new Date(Date.UTC(y, m - 1, d - 7));
  const previous = prevDate.toISOString().slice(0, 10);
  const [week, setWeek] = useState(current);
  const [worlds, setWorlds] = useState<{ w: string; members: number }[] | null>(null);
  const [w, setW] = useState<string | null>(null);
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<Tile | null>(null);

  useEffect(() => {
    let alive = true;
    setWorlds(null);
    setError(null);
    fetchWorlds(week).then(
      (list) => {
        if (!alive) return;
        setWorlds(list);
        setW((cur) => (cur && list.some((x) => x.w === cur) ? cur : (list[0]?.w ?? null)));
      },
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [week]);

  useEffect(() => {
    if (!w) return setData(null);
    let alive = true;
    setData(null);
    fetchWorldOnce(week, w).then(
      (x) => alive && setData(x),
      (e) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [week, w, reload]);

  const remove = async (tile: Tile) => {
    setConfirm(null);
    try {
      await removeTile(week, w!, tile.id);
      useGame.getState().toast(`🗑️ ${tile.id} vuelve a los bandidos`);
      setReload((n) => n + 1);
    } catch (e) {
      useGame.getState().toast(`⚠️ ${errorText(e)}`);
    }
  };

  const rows = data ? standings(data.tiles.values(), data.players) : [];
  const totalPlayers = worlds?.reduce((n, x) => n + x.members, 0) ?? 0;

  return (
    <>
      <div className="segmented">
        <button className={week === current ? 'active' : ''} onClick={() => setWeek(current)}>
          Esta semana
        </button>
        <button className={week === previous ? 'active' : ''} onClick={() => setWeek(previous)}>
          La anterior
        </button>
      </div>
      {error && <p className="empty">{error}</p>}
      <div className="card">
        <b>Conquista · semana del {week}</b>
        {worlds === null ? (
          <p className="muted">Cargando…</p>
        ) : worlds.length === 0 ? (
          <p className="muted">Nadie se ha unido esta semana.</p>
        ) : (
          <>
            <p className="muted">
              {totalPlayers} {totalPlayers === 1 ? 'alcalde' : 'alcaldes'} en {worlds.length} {worlds.length === 1 ? 'mundo' : 'mundos'}.
            </p>
            {worlds.length > 1 && (
              <div className="segmented wide">
                {worlds.map((x) => (
                  <button key={x.w} className={w === x.w ? 'active' : ''} onClick={() => setW(x.w)}>
                    {x.w} · {x.members}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {w && (
        <div className="card">
          <b>Clasificación de {w}</b>
          {!data ? (
            <p className="muted">Cargando…</p>
          ) : (
            <table className="admin-table">
              <tbody>
                {rows.map((r, i) => {
                  const own = [...data.tiles.values()].filter((t) => t.owner === r.uid && !t.capital).sort((a, b) => a.id.localeCompare(b.id));
                  return (
                    <tr key={r.uid}>
                      <td>{i + 1}.</td>
                      <td>
                        <b>{r.name}</b>
                        <div className="admin-tiles">
                          {own.map((t) => (
                            <button key={t.id} className="admin-tile" onClick={() => setConfirm(t)} title="Devolver a los bandidos">
                              {t.id === CENTER ? '👑' : ''}
                              {t.id} ✕
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="num">
                        {r.tiles} terr. · {r.points} pts
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <small className="muted">Toca un territorio para devolvérselo a los bandidos (moderación de trampas). Las capitales no se tocan.</small>
        </div>
      )}

      {confirm && (
        <Modal onBackdrop={() => setConfirm(null)}>
          <div className="result">
            <div className="big-emoji">🗑️</div>
            <p>
              ¿Quitar <b>{confirm.id}</b> a <b>{confirm.name}</b>? Vuelve a los bandidos.
            </p>
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={() => remove(confirm)}>
                Quitar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
