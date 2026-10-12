import { useCallback, useEffect, useRef, useState } from 'react';
import { Bus, Check, FileText, Plane, TrainFront } from 'lucide-react';

const ICONS = [Plane, TrainFront, Bus, FileText];
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches));
  useEffect(() => {
    const mql = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mql) return undefined;
    const onChange = (e) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * A ball that bounces and swaps icon (plane → train → bus → invoice) on every landing.
 * Once `done` is true it settles into a tick on the next landing, then calls `onFinished`.
 */
export default function BounceLoader({ done = false, onFinished, fullScreen = true }) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(false);
  const doneRef = useRef(done);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    doneRef.current = done;
    onFinishedRef.current = onFinished;
  }, [done, onFinished]);

  const land = useCallback(() => {
    if (doneRef.current) setCompleted(true);
    else setIndex((i) => (i + 1) % ICONS.length);
  }, []);

  // Without the bounce there are no landings to hook into, so swap on a timer instead.
  useEffect(() => {
    if (!reducedMotion || completed) return undefined;
    if (done) {
      setCompleted(true);
      return undefined;
    }
    const id = setInterval(land, 1200);
    return () => clearInterval(id);
  }, [reducedMotion, done, completed, land]);

  useEffect(() => {
    if (!completed) return undefined;
    // Long enough for the tick to finish drawing.
    const id = setTimeout(() => onFinishedRef.current?.(), reducedMotion ? 300 : 460);
    return () => clearTimeout(id);
  }, [completed, reducedMotion]);

  return (
    <div
      role="status"
      aria-label={completed ? 'Loaded' : 'Loading'}
      className={`flex w-full items-center justify-center ${fullScreen ? 'min-h-screen bg-slate-50' : 'h-screen'}`}
    >
      <div className={`bounce-loader ${completed ? 'is-done' : 'is-bouncing'}`}>
        <div className="bounce-loader-shadow" />
        <div className="bounce-loader-ball" onAnimationIteration={land}>
          {ICONS.map((Icon, i) => (
            <Icon
              key={Icon.displayName || i}
              aria-hidden="true"
              strokeWidth={1.9}
              className={`bounce-loader-icon ${!completed && i === index ? 'is-active' : ''}`}
            />
          ))}
          <Check aria-hidden="true" strokeWidth={2.6} className={`bounce-loader-icon bounce-loader-tick ${completed ? 'is-active' : ''}`} />
        </div>
      </div>
    </div>
  );
}
