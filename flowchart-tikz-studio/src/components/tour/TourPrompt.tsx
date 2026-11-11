import { useEffect, useState } from 'react';
import { TOUR_SEEN_KEY, useTour } from '../../state/tourStore';
import { Icon } from '../Icon';

/** A friendly, one-time invitation to take the tour. Never shown again once answered. */
export function TourPrompt({ onStart }: { onStart: () => void }) {
  const active = useTour((t) => t.active);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_SEEN_KEY) === '1';
    } catch {
      seen = false;
    }
    if (!seen) setShow(true);
  }, []);

  useEffect(() => {
    if (active) setShow(false);
  }, [active]);

  if (!show || active) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1');
    } catch {
      /* storage may be disabled */
    }
    setShow(false);
  };

  return (
    <div className="tour-prompt" role="complementary" aria-label="Guided tour invitation">
      <span className="tp-icon">
        <Icon name="sparkles" size={22} />
      </span>
      <div className="tp-text">
        <b>New to FlowTikZ?</b>
        <span>Take the 2-minute guided tour. It shows you every button, step by step.</span>
      </div>
      <div className="tp-actions">
        <button className="btn primary tiny" onClick={onStart} data-action="prompt-start-tour">
          <Icon name="play" size={15} />
          Show me around
        </button>
        <button className="btn ghost tiny" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
