import { useState } from 'react';
import { track } from '../../firebase';
import { sfx } from '../../ui/haptics';
import { GameScreen, Modal } from '../../ui/Modal';
import { fmtMult } from './logic';
import { TowersGameView } from './TowersScreen';

/**
 * Asalto de la Conquista: una batalla corta de la Guerra de torres antes de atacar un territorio. No
 * gasta tickets ni da monedas; su resultado es el bono que multiplica la fuerza del ataque.
 */
export default function AssaultScreen({
  title,
  level,
  onDone,
  onClose,
}: {
  title: string;
  level: number;
  /** Bono conseguido (1 si salió mal), al pulsar "Usar". */
  onDone: (mult: number) => void;
  onClose: () => void;
}) {
  const [mult, setMult] = useState<number | null>(null);

  const over = (m: number) => {
    setMult(m);
    track('conquest_assault', { level, mult: m });
    sfx(m > 1 ? 'win' : 'buy');
  };

  return (
    <GameScreen title={title} right={`⚔️ Nivel ${level}`} onClose={onClose}>
      <TowersGameView assault={{ level }} onScore={() => {}} onOver={(r) => over(r.mult)} />
      {mult !== null && (
        <Modal>
          <div className="result">
            <div className="big-emoji">{mult >= 1.5 ? '🏰' : mult > 1 ? '⚔️' : '💥'}</div>
            <div className="result-label">Bono de asalto</div>
            <div className="result-score">{fmtMult(mult)}</div>
            <p className="muted" style={{ margin: 0 }}>
              {mult > 1
                ? `Tus soldados atacarán con ${fmtMult(mult)} de fuerza. Puedes usar un bono cada 10 minutos.`
                : 'Esta vez no hubo bono: atacarás con tus soldados tal cual.'}
            </p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => onDone(mult)}>
                {mult > 1 ? '⚔️ Usar el bono' : 'Volver'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </GameScreen>
  );
}
