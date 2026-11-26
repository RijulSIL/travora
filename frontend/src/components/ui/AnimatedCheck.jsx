/*
 * A success tick that draws itself: the disc pops in, its ring draws round from the top, the tick
 * draws, then one soft pulse goes out. With reduced motion it's simply the finished tick.
 * Colour comes from `currentColor` (pass a text colour class, e.g. text-brand).
 */

const CSS = `
@keyframes ac-pop { 0% { transform: scale(.55); opacity: 0; } 60% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes ac-draw { to { stroke-dashoffset: 0; } }
@keyframes ac-pulse { 0% { transform: scale(.92); opacity: .5; } 100% { transform: scale(1.6); opacity: 0; } }
.ac-disc { transform-origin: center; animation: ac-pop .42s cubic-bezier(.34,1.56,.64,1) both; }
.ac-ring, .ac-tick { stroke-dasharray: 1; stroke-dashoffset: 1; }
.ac-ring { animation: ac-draw .5s cubic-bezier(.65,0,.35,1) .12s forwards; }
.ac-tick { animation: ac-draw .32s cubic-bezier(.65,0,.35,1) .55s forwards; }
.ac-pulse { opacity: 0; animation: ac-pulse .85s ease-out .85s both; }
@media (prefers-reduced-motion: reduce) {
  .ac-disc, .ac-ring, .ac-tick, .ac-pulse { animation: none; }
  .ac-ring, .ac-tick { stroke-dashoffset: 0; }
  .ac-pulse { opacity: 0; }
}
`;

export default function AnimatedCheck({ size = 64, className = '' }) {
  return (
    <span className={`relative inline-grid flex-none place-items-center ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <style>{CSS}</style>
      <span className="ac-pulse absolute inset-0 rounded-full border-2 border-current" />
      <svg className="ac-disc relative" width={size} height={size} viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="30" className="fill-emerald-50" />
        {/* The ring starts at the top and draws clockwise. */}
        <path
          className="ac-ring"
          d="M32 4a28 28 0 1 1 0 56a28 28 0 1 1 0-56"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength="1"
        />
        <path
          className="ac-tick"
          d="M20.5 33.5l7.5 7.5L44 25"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
        />
      </svg>
    </span>
  );
}
