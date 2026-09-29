import { Link } from 'react-router-dom';

const INK = '#1c3350';

const SHEEP = [
  { bottom: 50, height: 'h-12', delay: '0s', duration: '6s' },
  { bottom: 48, height: 'h-13', delay: '-1.9s', duration: '6.8s' },
  { bottom: 53, height: 'h-9', delay: '-3.5s', duration: '5.6s' },
  { bottom: 51, height: 'h-11', delay: '-4.9s', duration: '7.2s' },
];

// Nine outward-bulging arcs around an ellipse — the leafy silhouette shared by both apple trees.
const CANOPY =
  'M60,12 A18,18 0 0,1 90.9,22.8 A18,18 0 0,1 107.3,50 A18,18 0 0,1 101.6,81 A18,18 0 0,1 76.4,101.2 A18,18 0 0,1 43.6,101.2 A18,18 0 0,1 18.4,81 A18,18 0 0,1 12.7,50 A18,18 0 0,1 29.1,22.8 A18,18 0 0,1 60,12 Z';

const TUFTS = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="13" viewBox="0 0 52 13"><g fill="none" stroke="#3f9440" stroke-width="2.4" stroke-linecap="round"><path d="M7 13V6"/><path d="M11 13c0-4-1-6-2-8"/><path d="M14 13c0-3 1-5 3-6"/><path d="M28 13c0-3-1-4-2-5"/><path d="M31 13V7"/><path d="M35 13c0-4 1-6 2-8"/></g></svg>',
)}")`;

const SOIL =
  'radial-gradient(circle at 7px 9px, rgba(88,56,26,0.42) 1.7px, transparent 1.9px),' +
  'radial-gradient(circle at 25px 22px, rgba(88,56,26,0.34) 1.4px, transparent 1.6px),' +
  'radial-gradient(circle at 37px 7px, rgba(88,56,26,0.38) 1.5px, transparent 1.7px),' +
  'radial-gradient(circle at 15px 32px, rgba(88,56,26,0.28) 1.2px, transparent 1.4px)';

function Sun() {
  const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  return (
    <svg viewBox="0 0 100 100" className="absolute left-[2%] top-4 h-[84px] w-[84px]" aria-hidden="true">
      <defs>
        <radialGradient id="sunGlow" cx="42%" cy="38%" r="66%">
          <stop offset="0%" stopColor="#ffe28d" />
          <stop offset="100%" stopColor="#f2a33a" />
        </radialGradient>
      </defs>
      <g stroke="#f4a72f" strokeWidth="4" strokeLinecap="round">
        {rays.map((deg) => {
          const c = Math.cos((deg * Math.PI) / 180);
          const s = Math.sin((deg * Math.PI) / 180);
          return <line key={deg} x1={50 + 28 * c} y1={50 + 28 * s} x2={50 + 45 * c} y2={50 + 45 * s} />;
        })}
      </g>
      <circle cx="50" cy="50" r="21" fill="url(#sunGlow)" />
    </svg>
  );
}

function Cloud({ className }) {
  return (
    <svg viewBox="0 0 120 62" className={className} aria-hidden="true">
      <path
        d="M18,57 C6,57 0,48 6,40 C1,29 12,19 22,24 C26,9 46,3 56,14 C64,3 84,5 88,19 C102,16 116,26 112,40 C120,45 117,57 104,57 Z"
        fill="#dbdfe3"
        stroke={INK}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M27,25 C31,13 46,8 55,17" fill="none" stroke="#f2f4f6" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function Apple({ cx, cy, r = 9, leaf = true }) {
  return (
    <g>
      {leaf && (
        <>
          <path
            d={`M${cx},${cy - r + 1} q1,-6 4,-9`}
            fill="none"
            stroke="#4a3a24"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d={`M${cx + 4},${cy - r - 4} C${cx + 8},${cy - r - 12} ${cx + 17},${cy - r - 11} ${cx + 17},${cy - r - 5} C${cx + 12},${cy - r - 2} ${cx + 6},${cy - r - 2} ${cx + 4},${cy - r - 4} Z`}
            fill="#1f5c2e"
            stroke={INK}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </>
      )}
      <circle cx={cx} cy={cy} r={r} fill="#e0242a" stroke={INK} strokeWidth={r > 7 ? 3 : 2.4} />
    </g>
  );
}

function AppleTree({ className, apples, branch, clipId }) {
  return (
    <svg viewBox="0 0 120 196" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <path d={CANOPY} />
        </clipPath>
      </defs>
      {/* Trunk — top tucked behind the canopy, base flaring into roots */}
      <path
        d="M47,60 L47,148 C47,164 37,172 29,182 C25,187 26,196 32,196 L88,196 C94,196 95,187 91,182 C83,172 73,164 73,148 L73,60 Z"
        fill="#8b5a2b"
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d={CANOPY} fill="#2f7d45" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx="92" cy="90" rx="44" ry="36" fill="#25693a" />
        <ellipse cx="38" cy="34" rx="26" ry="19" fill="#3c9151" opacity="0.55" />
      </g>
      {apples.map((a, i) => (
        <Apple key={i} cx={a[0]} cy={a[1]} />
      ))}
    </svg>
  );
}

function Bush({ className }) {
  const berries = [
    [28, 66], [46, 52], [66, 44], [88, 48], [110, 58],
    [36, 82], [58, 70], [80, 68], [104, 78], [126, 70],
  ];
  return (
    <svg viewBox="0 0 150 100" className={className} aria-hidden="true">
      <defs>
        <clipPath id="bushClip">
          <path d="M6,94 C-2,74 4,58 18,56 C20,38 40,28 56,38 C64,24 88,24 96,38 C112,30 132,42 130,58 C144,62 150,82 142,94 Z" />
        </clipPath>
      </defs>
      <path
        d="M6,94 C-2,74 4,58 18,56 C20,38 40,28 56,38 C64,24 88,24 96,38 C112,30 132,42 130,58 C144,62 150,82 142,94 Z"
        fill="#2f7d45"
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <g clipPath="url(#bushClip)">
        <ellipse cx="112" cy="86" rx="46" ry="26" fill="#25693a" />
      </g>
      {berries.map((b, i) => (
        <Apple key={i} cx={b[0]} cy={b[1]} r={6} leaf={false} />
      ))}
    </svg>
  );
}



// The barn stands side-on at the right edge and runs off-frame. It's cropped to start right where
// the roof was already flat (past the near gable's curve), so the visible wall is a plain,
// fully-closed side with a decorative sliding door — no cutaway, nothing floating.
const BARN_BOX = 'absolute bottom-[50px] right-[-22px] h-[180px] w-[132px]';

function BarnShell({ className }) {
  return (
    <svg viewBox="78 0 132 180" className={className} aria-hidden="true">
      {/* Roof — one solid red shape (no white trim), overhanging 14 units past the wall's face
          on the left like a real eave. Its own left edge (x=78) sits at the crop boundary, so
          that edge is a genuinely drawn side of the path and picks up a stroke instead of being
          an unbordered hard crop. The top-left and bottom-left corners are rounded off (the two
          that are actually visible — the right side runs off-frame, so there's no corner there
          to round). */}
      <path
        d="M78,80 L78,28 Q78,21 85,21 L210,21 L210,87 L85,87 Q78,87 78,80 Z"
        fill="#d8272c"
        stroke={INK}
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      {/* Solid wall, set back under the eave */}
      <path d="M92,87 H210 V180 H92 Z" fill="#d8272c" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
      {/* Sliding door parked shut, and the rail it hangs from */}
      <rect x="92" y="90" width="102" height="5" rx="2" fill="#8a5a34" stroke={INK} strokeWidth="2" />
      <rect x="100" y="93" width="74" height="87" fill="#b5763c" stroke={INK} strokeWidth="3" />
      <g stroke={INK} strokeWidth="1.8" opacity="0.55">
        <line x1="119" y1="97" x2="119" y2="180" />
        <line x1="137" y1="97" x2="137" y2="180" />
        <line x1="155" y1="97" x2="155" y2="180" />
      </g>
    </svg>
  );
}

function Fence() {
  const rail = { backgroundColor: '#b57a3f', borderColor: INK };
  return (
    // Runs all the way up to the barn's (now solid) left edge, so there's no gap of bare grass
    // between the last post and the wall.
    <div className="absolute bottom-[50px] left-0 right-[12.5%] h-[54px]" aria-hidden="true">
      <div className="absolute inset-x-0 top-[11px] h-[10px] border-y-[3px]" style={rail} />
      <div className="absolute inset-x-0 top-[32px] h-[10px] border-y-[3px]" style={rail} />
      <div className="absolute inset-x-0 top-0 flex h-full justify-between px-[1.5%]">
        {Array.from({ length: 13 }).map((_, i) => (
          <div
            key={i}
            className="h-full w-[11px] rounded-[2px] border-[3px]"
            style={{ backgroundColor: '#a9713c', borderColor: INK }}
          />
        ))}
      </div>
    </div>
  );
}

function Sheep({ height, walkStyle, jumpStyle, legStyle, enterStyle }) {
  return (
    // Three nested elements, one animated property each: `left` travels the field, the middle
    // wrapper shrinks/fades into the barn, and the svg carries the hop. Keeping `left` and
    // `transform` on separate elements avoids Tailwind/PostCSS folding them into one translateX,
    // which would resolve the percentage against the sheep's own width instead of the scene.
    <div className="absolute animate-sheep-walk" style={walkStyle}>
      <div className="origin-bottom animate-sheep-enter" style={enterStyle}>
        <svg viewBox="0 0 60 42" className={`block w-auto animate-sheep-jump ${height}`} style={jumpStyle} aria-hidden="true">
          {/* Legs — an actual stepping cycle, fades out mid-hop. Front and back pairs pivot at
              their own hip point and swing in opposite phase on a short, fixed-length loop that
              runs independently of the 6s walk clock, so the legs keep cycling at a natural
              stepping pace no matter how the body's own timeline stretches or pauses. */}
          <g className="animate-legs-run" style={legStyle}>
            <g style={{ transformOrigin: '30px 27px' }} className="animate-legs-step-back">
              <rect x="33" y="27" width="3.4" height="9" rx="1.7" fill={INK} transform="rotate(12 34.7 27)" />
              <rect x="26" y="28.5" width="3.4" height="8" rx="1.7" fill={INK} transform="rotate(-8 27.7 28.5)" />
            </g>
            <g style={{ transformOrigin: '14px 27px' }} className="animate-legs-step-front">
              <rect x="17" y="28.5" width="3.4" height="8" rx="1.7" fill={INK} transform="rotate(10 18.7 28.5)" />
              <rect x="10" y="27" width="3.4" height="9" rx="1.7" fill={INK} transform="rotate(-12 11.7 27)" />
            </g>
          </g>
          {/* Legs — tucked up, fades in at the peak of the hop */}
          <g className="animate-legs-tuck" style={legStyle}>
            <rect x="28" y="24" width="8" height="5.5" rx="2.75" fill={INK} />
            <rect x="12" y="24" width="8" height="5.5" rx="2.75" fill={INK} />
          </g>

          <circle cx="6" cy="19" r="3.2" fill="#f1f3f6" stroke={INK} strokeWidth="2" />
          {/* Woolly body — one stroked torso plus strokeless "poof" bumps so there are no messy overlapping outlines */}
          <ellipse cx="26" cy="20" rx="16" ry="10" fill="#f1f3f6" stroke={INK} strokeWidth="2" />
          <circle cx="14" cy="12" r="7" fill="#f1f3f6" />
          <circle cx="25" cy="8" r="8.5" fill="#f1f3f6" />
          <circle cx="36" cy="12" r="7" fill="#f1f3f6" />
          {/* Sunlit highlight — a couple of brighter patches on the top-left poofs, facing the
              scene's sun, so the wool reads as rounded rather than a flat white cutout. */}
          <ellipse cx="22" cy="5" rx="4.2" ry="3" fill="#fff" opacity="0.9" />
          <ellipse cx="11" cy="9.5" rx="3" ry="2.2" fill="#fff" opacity="0.85" />

          {/* Head — a small independent nod on its own loop, on top of (and slightly out of
              phase with) the whole-body sway carried by animate-sheep-jump, so head and body
              don't rock in lockstep. */}
          <g style={{ transformOrigin: '44px 16px' }} className="animate-head-nod">
            <circle cx="48" cy="16" r="6.5" fill={INK} />
            <path d="M44 10.5 Q46 5.5 50.5 7.5 Q48.5 10.5 44 10.5 Z" fill={INK} />
            <circle cx="51" cy="14.5" r="1.1" fill="#cbd5e1" />
          </g>
        </svg>
      </div>
    </div>
  );
}

export default function AccessDenied() {
  return (
    // `relative z-10`: the app renders a fixed, z-index:0 particle canvas at the root
    // (ParticleBackground). Without its own position, this page is plain static-flow content,
    // which paints *before* positioned z-index elements — so those particles end up drawn on
    // top of the scene afterward, not behind it, no matter how opaque the card's own background
    // is. Giving the page its own stacking context above the canvas fixes that.
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      {/* The scene is laid out at a fixed 768x264 and scaled down to fit narrow screens, so every
          element keeps its proportions instead of colliding as the viewport shrinks. The card
          chrome (sky gradient, border, shadow) lives on this outer, already-clipped-to-size
          wrapper rather than the inner scaled one, so it frames exactly the visible area instead
          of getting scaled/cropped along with the scene. */}
      <div className="mx-auto h-[119px] w-[346px] overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-sky-200 via-sky-50 to-white shadow-sm sm:h-[198px] sm:w-[576px] min-[820px]:h-[264px] min-[820px]:w-[768px]">
        <div className="relative h-[264px] w-[768px] origin-top-left scale-[0.45] sm:scale-75 min-[820px]:scale-100">
          <Sun />
          <Cloud className="absolute left-[28%] top-[46px] h-[51px] w-[98px]" />
          <Cloud className="absolute left-[43%] top-[6px] h-[60px] w-[116px]" />

          <Fence />

          <AppleTree
            className="absolute bottom-[50px] left-[7%] h-[193px] w-[118px]"
            clipId="canopyA"
            branch="M68,116 C78,108 88,92 94,76"
            apples={[
              [44, 30],
              [76, 44],
              [34, 64],
              [62, 78],
              [88, 66],
            ]}
          />

          <Bush className="absolute bottom-[50px] left-[46.5%] h-[64px] w-[96px]" />

          <AppleTree
            className="absolute bottom-[50px] left-[57%] h-[209px] w-[128px]"
            clipId="canopyB"
            branch="M52,116 C42,108 32,92 26,76"
            apples={[
              [46, 28],
              [78, 38],
              [30, 58],
              [64, 62],
              [94, 58],
              [52, 86],
            ]}
          />

          {/* The flock: in from the left, over the bush, then behind the barn wall. Painted
              before the barn (not after), so the wall's opaque fill physically covers them as
              they walk underneath it — real occlusion, not just a fade standing in for it. */}
          {SHEEP.map((s, i) => (
            <Sheep
              key={i}
              height={s.height}
              walkStyle={{ bottom: s.bottom, animationDuration: s.duration, animationDelay: s.delay }}
              enterStyle={{ animationDuration: s.duration, animationDelay: s.delay }}
              jumpStyle={{ animationDuration: s.duration, animationDelay: s.delay }}
              legStyle={{ animationDuration: s.duration, animationDelay: s.delay }}
            />
          ))}

          <BarnShell className={BARN_BOX} />

          {/* Grass blades, drawn over the bases so everything looks planted in the field */}
          <div
            className="absolute inset-x-2 bottom-[53px] h-[13px]"
            style={{ backgroundImage: TUFTS, backgroundRepeat: 'repeat-x', backgroundPosition: 'left bottom' }}
            aria-hidden="true"
          />

          <div className="absolute inset-x-0 bottom-0 h-14 overflow-hidden rounded-xl" aria-hidden="true">
            <div className="absolute inset-x-0 top-0 h-[14px] bg-[#67b04f]" />
            <div
              className="absolute inset-x-0 bottom-0 h-[42px] bg-[#a97744]"
              style={{ backgroundImage: SOIL, backgroundSize: '44px 38px' }}
            />
          </div>
        </div>
      </div>

      <h1 className="mt-10 text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: INK }}>
        Access Denied
      </h1>
      <p className="mt-3 max-w-lg text-base text-slate-500">
        You don&apos;t have permission to access this page. Please contact the administrator.
      </p>

      <Link to="/dashboard" className="btn-primary mt-7">
        Back to home
      </Link>
    </div>
  );
}
