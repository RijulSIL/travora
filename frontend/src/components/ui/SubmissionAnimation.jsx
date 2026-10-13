import { Bus, Plane, ReceiptIndianRupee, TrainFront } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const MODE_ICONS = { BUS: Bus, TRAIN: TrainFront, FLIGHT: Plane, CLAIM: ReceiptIndianRupee };

export default function SubmissionAnimation({ mode, status, onComplete }) {
  const [phase, setPhase] = useState('idle');

  useEffect(() => {
    let t;

    if (status === 'submitting' && phase === 'idle') {
      setPhase('submitting');
    } else if (status === 'success' && phase === 'submitting') {
      setPhase('morphing');
    } else if (phase === 'morphing') {
      t = setTimeout(() => setPhase('settled'), 600);
    } else if (phase === 'settled') {
      t = setTimeout(() => setPhase('anticipation'), 2400);
    } else if (phase === 'anticipation') {
      t = setTimeout(() => setPhase('driving'), 400);
    } else if (phase === 'driving') {
      t = setTimeout(() => {
        setPhase('done');
        if (onComplete) onComplete();
      }, 800);
    }

    return () => clearTimeout(t);
  }, [status, phase, onComplete]);

  // Derived animation states
  const isSubmitting = phase === 'submitting';
  const isMorphing = phase === 'morphing';
  const isSettled = phase === 'settled';
  const isAnticipation = phase === 'anticipation';
  const isDriving = phase === 'driving';
  const isVehiclePhase = isMorphing || isSettled || isAnticipation || isDriving;

  // Wrapper translation (Moves right when card emerges, zooms off screen when driving)
  let wrapperTransform = 'translateX(0) scale(1)';
  if (isSettled) {
    wrapperTransform = 'translateX(110px) scale(1)';
  } else if (isAnticipation) {
    wrapperTransform = 'translateX(90px) scale(1) rotate(-1deg)'; // Wind up backwards
  } else if (isDriving) {
    wrapperTransform = 'translateX(120vw) scale(1) rotate(1deg)'; // Drive away fast
  }

  // Core Morphing Properties
  let coreWidth = '140px';
  let coreHeight = '40px';
  let coreRadius = '8px';
  let coreBg = '#0F6B52';

  if (isSubmitting) {
    coreWidth = '240px';
    coreHeight = '14px';
    coreRadius = '7px';
  } else if (isVehiclePhase) {
    if (mode === 'FLIGHT') {
      coreWidth = '240px';
      coreHeight = '90px';
      coreRadius = '0px';
      coreBg = 'transparent';
    } else if (mode === 'TRAIN') {
      coreWidth = '220px';
      coreHeight = '120px';
      coreRadius = '0px';
      coreBg = 'transparent';
    } else if (mode === 'CLAIM') {
      coreWidth = '140px';
      coreHeight = '90px';
      coreRadius = '0px';
      coreBg = 'transparent';
    } else {
      // BUS
      coreWidth = '220px';
      coreHeight = '85px';
      coreRadius = '0px';
      coreBg = 'transparent';
    }
  }

  return createPortal(
    <div 
      className="fixed inset-0 z-[200] grid place-items-center bg-slate-900/60 backdrop-blur-sm transition-opacity duration-500 ease-in-out" 
      style={{ opacity: (phase === 'done' || phase === 'idle') ? 0 : 1 }}
    >
      <style>{`
        @keyframes progress-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes wheel-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes engine-vibrate {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1.5px); }
        }
        @keyframes dust-trail {
          0% { opacity: 0; transform: scale(0.5) translate(0, 0); }
          20% { opacity: 0.8; }
          100% { opacity: 0; transform: scale(2) translate(-40px, -10px); }
        }
        @keyframes cloud-rush {
          0% { transform: translateX(0) scale(0.5); opacity: 0; }
          20% { opacity: 0.9; }
          100% { transform: translateX(-200px) scale(1.5); opacity: 0; }
        }
        @keyframes exhaust-puff {
          0% { opacity: 0; transform: translate(0, 0) scale(0.35); }
          12% { opacity: 0.9; }
          100% { opacity: 0; transform: translate(-70px, -26px) scale(3); }
        }
        @keyframes particle-rush {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(-150px); opacity: 0; }
        }
      `}</style>

      {/* Main Assembly Wrapper */}
      <div 
        className="relative flex items-center justify-center transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: wrapperTransform }}
      >
        
        {/* The Success Card (Slides out from behind the vehicle) */}
        <div 
          className="absolute left-0 w-[340px] h-[100px] bg-white rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.1)] border border-slate-100 flex items-center px-6 transition-all duration-[600ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] z-0"
          style={{
            transform: isSettled || isAnticipation || isDriving ? 'translateX(-320px)' : 'translateX(0)',
            opacity: isSettled || isAnticipation || isDriving ? 1 : 0,
            scale: isSettled || isAnticipation || isDriving ? '1' : '0.8',
          }}
        >
          <div className="flex-1">
            <h3 className="flex items-center gap-1.5 font-bold text-[#0F6B52] text-[18px] mb-1 tracking-tight">
              {(() => {
                const ModeIcon = MODE_ICONS[mode] || ReceiptIndianRupee;
                return <ModeIcon size={18} className="shrink-0" />;
              })()}
              Request Submitted
            </h3>
            <p className="text-[#2E8B74] text-[13px] font-medium leading-relaxed opacity-90">
              Your {mode === 'CLAIM' ? 'claim' : 'trip'} is on its way.<br/>
              We&apos;ll notify you once it&apos;s approved.
            </p>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100 shadow-inner">
            <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        {/* The Morphing Core */}
        <div 
          className="relative z-10 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          style={{
            width: coreWidth,
            height: coreHeight,
            borderRadius: coreRadius,
            backgroundColor: coreBg,
            animation: (isSettled && !isDriving) ? 'engine-vibrate 0.1s infinite' : 'none',
            boxShadow: !isVehiclePhase ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)' : 'none',
            overflow: !isVehiclePhase ? 'hidden' : 'visible'
          }}
        >
          {/* Progress Shimmer (Only visible during submitting) */}
          <div 
            className="absolute inset-0 bg-white/20 transition-opacity duration-300 z-50"
            style={{ 
              opacity: isSubmitting ? 1 : 0,
              animation: isSubmitting ? 'progress-shimmer 1.5s infinite linear' : 'none' 
            }}
          />

          {/* ----- BUS SPECIFIC DETAILS ----- */}
          {mode === 'BUS' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
              <svg width="220" height="85" viewBox="0 0 220 85" overflow="visible" aria-hidden="true">
                <defs>
                <linearGradient id="subm-bus-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f6fbf9"/>
                <stop offset="0.5" stopColor="#E6F2F0"/>
                <stop offset="1" stopColor="#c6d9d3"/>
                </linearGradient>
                <linearGradient id="subm-bus-green" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1a8f6b"/>
                <stop offset="0.5" stopColor="#0F6B52"/>
                <stop offset="1" stopColor="#0b5240"/>
                </linearGradient>
                <linearGradient id="subm-bus-glass" x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0" stopColor="#4f6b69"/>
                <stop offset="0.45" stopColor="#1c2b2f"/>
                <stop offset="1" stopColor="#0e171a"/>
                </linearGradient>
                <radialGradient id="subm-bus-lamp" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#ffffff"/>
                <stop offset="0.45" stopColor="#fff6d2" stopOpacity="0.85"/>
                <stop offset="1" stopColor="#fff6d2" stopOpacity="0"/>
                </radialGradient>
                <clipPath id="subm-bus-body-clip">
                <path id="subm-bus-hull" d="M6 9 C6 5.1 9.1 2 13 2 L198 2 C207 2 213 7.4 214.8 15.6 L218.6 58 C219.2 65 218.8 72 216 76.4 C214.2 79 211.2 80 207.6 80 L166.8 80 A16.8 16.8 0 0 0 133.2 80 L60.8 80 A16.8 16.8 0 0 0 27.2 80 L13 80 C9.1 80 6 76.9 6 73 Z"/>
                </clipPath>
                </defs>

                {/* Wheel-arch shadows (the separate spinning wheels sit in these) */}
                <circle cx="44" cy="80" r="16.8" fill="#26302e"/>
                <circle cx="150" cy="80" r="16.8" fill="#26302e"/>

                {/* Body */}
                <use href="#subm-bus-hull" fill="url(#subm-bus-body)"/>

                <g clipPath="url(#subm-bus-body-clip)">
                {/* Roof band */}
                <rect x="0" y="0" width="230" height="9.4" fill="url(#subm-bus-green)"/>
                <path d="M8 3.6 L200 3.6" stroke="#ffffff" strokeWidth="0.9" opacity="0.35"/>
                {/* Lower skirt band */}
                <rect x="0" y="66" width="230" height="20" fill="url(#subm-bus-green)"/>
                <path d="M0 66.6 L230 66.6" stroke="#ffffff" strokeWidth="0.8" opacity="0.3"/>
                {/* Mint accent line */}
                <path d="M0 60.6 L230 60.6" stroke="#7cc4ae" strokeWidth="1.4"/>
                {/* Lower body shade */}
                <rect x="0" y="50" width="230" height="10" fill="#9fb6b0" opacity="0.15"/>
                </g>

                {/* Passenger window band with pillars */}
                <rect x="14" y="14" width="150" height="27" rx="3" fill="url(#subm-bus-glass)"/>
                <g stroke="#dcebe7" strokeWidth="2">
                <path d="M44 14 L44 41"/><path d="M74 14 L74 41"/><path d="M104 14 L104 41"/><path d="M134 14 L134 41"/>
                </g>
                <path d="M16 16.4 L162 16.4" stroke="#ffffff" strokeWidth="0.9" opacity="0.22"/>
                <g fill="#ffffff" opacity="0.12">
                <path d="M22 14 L30 14 L20 41 L12 41 Z"/><path d="M76 14 L82 14 L72 41 L66 41 Z"/><path d="M146 14 L152 14 L142 41 L136 41 Z"/>
                </g>

                {/* Entry door (glass) */}
                <rect x="169.4" y="14" width="21.6" height="64" rx="2.4" fill="#d3e3de" stroke="#a9c2bb" strokeWidth="0.8"/>
                <rect x="171.8" y="16.4" width="7.6" height="59" rx="1.4" fill="url(#subm-bus-glass)"/>
                <rect x="181" y="16.4" width="7.6" height="59" rx="1.4" fill="url(#subm-bus-glass)"/>

                {/* Windscreen */}
                <path d="M194 13 L205.6 13 C209.6 13 212.4 15.8 213 19.6 L216 46 C216.3 48.6 214.6 50 212.4 50 L196 50 C194.8 50 194 49.2 194 48 Z" fill="url(#subm-bus-glass)"/>
                <path d="M201 13 L206 13 L198.6 50 L194 50 L194 46 Z" fill="#ffffff" opacity="0.13"/>

                {/* Destination sign */}
                <rect x="183" y="4.6" width="25" height="5.4" rx="1.2" fill="#13201e"/>
                <g fill="#7cf0c6" opacity="0.9">
                <rect x="186" y="6.6" width="2" height="1.4"/><rect x="189.4" y="6.6" width="2" height="1.4"/><rect x="192.8" y="6.6" width="2" height="1.4"/><rect x="196.2" y="6.6" width="2" height="1.4"/><rect x="199.6" y="6.6" width="2" height="1.4"/><rect x="203" y="6.6" width="2" height="1.4"/>
                </g>

                {/* Side mirror */}
                <path d="M212 14 C216 12 220 13 221.4 16.4" fill="none" stroke="#2f3f3b" strokeWidth="1.4" strokeLinecap="round"/>
                <rect x="219.6" y="15.8" width="3.6" height="9" rx="1.4" fill="#2f3f3b"/>

                {/* Headlight + tail light + rear engine vents */}
                <path d="M211 56.6 L217.6 56.6 C218.4 56.6 218.8 57.4 218.6 58.2 L218.2 61 C218.1 61.6 217.6 62 217 62 L211 62 C210.2 62 209.8 61.4 209.8 60.8 L209.8 57.8 C209.8 57.1 210.3 56.6 211 56.6 Z" fill="#f6f9f8" stroke="#9ab3ac" strokeWidth="0.5"/>
                <ellipse cx="216" cy="59.4" rx="6" ry="3.6" fill="url(#subm-bus-lamp)" opacity="0.7"/>
                <rect x="6.4" y="46" width="3.4" height="12" rx="1.2" fill="#e5484d"/>
                <g stroke="#9fb6b0" strokeWidth="1" strokeLinecap="round">
                <path d="M14 46 L30 46"/><path d="M14 49.6 L30 49.6"/><path d="M14 53.2 L30 53.2"/>
                </g>
                {/* Exhaust pipe */}
                <rect x="2.6" y="75.4" width="8" height="2.8" rx="1.2" fill="#3a4542"/>
                <ellipse cx="3" cy="76.8" rx="0.9" ry="1.3" fill="#141a19"/>
              </svg>
            </div>
          )}

          {/* ----- FLIGHT SPECIFIC DETAILS ----- */}
          {mode === 'FLIGHT' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
                <svg width="240" height="90" viewBox="0 0 240 90" overflow="visible" aria-hidden="true">
                  <defs>
                  {/* Cylindrical shading: slight edge darkening on top, bright highlight band, shaded belly */}
                  <linearGradient id="subm-jet-body" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e4eae8"/>
                  <stop offset="0.14" stopColor="#ffffff"/>
                  <stop offset="0.42" stopColor="#f6f8f7"/>
                  <stop offset="0.74" stopColor="#e0e6e4"/>
                  <stop offset="1" stopColor="#aab6b2"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-fin" x1="0" y1="0" x2="1" y2="0.6">
                  <stop offset="0" stopColor="#1a9270"/>
                  <stop offset="0.5" stopColor="#0F6B52"/>
                  <stop offset="1" stopColor="#094535"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-livery" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#0b5240"/>
                  <stop offset="0.6" stopColor="#0F6B52"/>
                  <stop offset="1" stopColor="#14805f"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-wing" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#eef2f1"/>
                  <stop offset="0.5" stopColor="#cdd6d3"/>
                  <stop offset="1" stopColor="#8f9e99"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-nacelle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e8edeb"/>
                  <stop offset="0.18" stopColor="#ffffff"/>
                  <stop offset="0.5" stopColor="#eef2f1"/>
                  <stop offset="0.82" stopColor="#cdd5d2"/>
                  <stop offset="1" stopColor="#97a5a0"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-nozzle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#9aa6a2"/>
                  <stop offset="0.45" stopColor="#6d7a76"/>
                  <stop offset="1" stopColor="#3f4a47"/>
                  </linearGradient>
                  <linearGradient id="subm-jet-glass" x1="0" y1="0" x2="0.6" y2="1">
                  <stop offset="0" stopColor="#5d7a78"/>
                  <stop offset="0.45" stopColor="#22343a"/>
                  <stop offset="1" stopColor="#121c20"/>
                  </linearGradient>
                  <radialGradient id="subm-jet-shadow" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0" stopColor="#3b4a46" stopOpacity="0.32"/>
                  <stop offset="1" stopColor="#3b4a46" stopOpacity="0"/>
                  </radialGradient>
                  <clipPath id="subm-jet-fuselage">
                  <path id="subm-jet-hull" d="M237.6 57 C234.4 50.2 224 45.4 212 44.6 C209 44.2 206 44.1 202 44.1 L78 43.8 C52 43.8 24 44.9 7.4 46.9 C5.2 47.2 4.4 48.6 5.6 49.5 L7.6 49.9 C32 55.4 62 62.8 94 63 L207 63 C222 63 232 61.4 236.6 59 C237.4 58.5 237.8 57.8 237.6 57 Z"/>
                  </clipPath>
                  </defs>

                  {/* Vertical fin with dorsal fillet */}
                  <path d="M86 44 C76 43.6 70 41.6 66.4 38.6 L29.4 9.6 C28.6 8.9 27.6 8.6 26.4 8.6 L14.6 8.6 C12.6 8.6 11.6 9.8 11.8 11.6 L18.6 45.6 Z" fill="url(#subm-jet-fin)"/>
                  <path d="M66.4 38.6 L29.4 9.6" stroke="#2bb08a" strokeWidth="0.7" opacity="0.6" fill="none"/>
                  <path d="M18.4 9.2 L24.6 44.6" stroke="#06382b" strokeWidth="0.55" opacity="0.6"/>

                  {/* T-tail: level, thin, slightly swept stabiliser seen edge-on + slim junction fairing */}
                  <path d="M42 8.4 L7.6 7.7 C5.6 7.7 4.8 8.3 5.4 8.9 L7.4 9.5 L37 10.4 Z" fill="#0b5240"/>
                  <path d="M42 8.4 L7.6 7.7" stroke="#2bb08a" strokeWidth="0.5" opacity="0.6"/>
                  <path d="M37.6 8.9 C37.6 8.1 33.6 7.7 26 7.7 C18.6 7.7 14.4 8.1 14.4 8.9 C14.4 9.7 18.6 10.1 26 10.1 C33.6 10.1 37.6 9.7 37.6 8.9 Z" fill="#0e624b"/>
                  <path d="M15.4 8.3 C19 8 33 8 36.6 8.3" stroke="#3cbf98" strokeWidth="0.4" opacity="0.5" fill="none"/>

                  {/* Fuselage */}
                  <use href="#subm-jet-hull" fill="url(#subm-jet-body)"/>

                  <g clipPath="url(#subm-jet-fuselage)">
                  {/* specular highlight */}
                  <rect x="0" y="45.6" width="240" height="1.2" fill="#ffffff" opacity="0.95"/>
                  {/* radome */}
                  <ellipse cx="237" cy="57.4" rx="9" ry="6.4" fill="#d5dcda" opacity="0.55"/>
                  <path d="M231.2 50.6 C232.6 53.6 232.6 58.4 231.6 61.2" fill="none" stroke="#bcc6c2" strokeWidth="0.35" opacity="0.8"/>
                  {/* sweeping livery: green band rising from the nose toward the tail */}
                  <path d="M232.4 59 C224 57.6 200 57.4 160 57.4 C120 57.2 92 56 70 53.6 C50 51.4 30 48.4 10 45 L9 46.8 C30 51.6 52 56.8 76 59.4 C100 61.4 126 61.6 160 61.4 C200 61.3 224 61 232.4 59 Z" fill="url(#subm-jet-livery)"/>
                  <path d="M229.6 57.4 C220 56.4 200 56.1 160 56.1 C120 55.9 92 54.7 70 52.3 C50 50.1 30 47.1 10 43.7" fill="none" stroke="#7cc4ae" strokeWidth="0.6"/>
                  {/* faint panel lines */}
                  <g stroke="#b9c4c0" strokeWidth="0.3" opacity="0.45">
                  <path d="M203.6 43 L203.6 64"/>
                  <path d="M104 43 L104 64"/>
                  <path d="M187 43 L187 64"/>
                  </g>
                  {/* metal tail cap */}
                  <rect x="0" y="40" width="7.6" height="14" fill="#9aa7a3" opacity="0.6"/>
                  {/* belly occlusion */}
                  <rect x="0" y="61.8" width="240" height="3" fill="#7d8b87" opacity="0.18"/>
                  </g>

                  {/* Cockpit windows */}
                  <clipPath id="subm-jet-cockpit-glass">
                  <path d="M206.8 46.9 L220.4 46.9 C223.6 47.6 226.4 49.3 228.2 51.5 L208.4 51.7 C207.4 51.7 206.8 51 206.8 50.2 Z"/>
                  </clipPath>
                  <path d="M206.2 46.1 L220.6 46.1 C224.2 46.8 227.2 48.6 229.2 51" fill="none" stroke="#c3ccc9" strokeWidth="0.7"/>
                  <path d="M206.8 46.9 L220.4 46.9 C223.6 47.6 226.4 49.3 228.2 51.5 L208.4 51.7 C207.4 51.7 206.8 51 206.8 50.2 Z" fill="url(#subm-jet-glass)" stroke="#2c3b37" strokeWidth="0.45"/>
                  <g clipPath="url(#subm-jet-cockpit-glass)">
                  <path d="M215 45 L220.6 45 L214.6 53 L209 53 Z" fill="#ffffff" opacity="0.18"/>
                  <path d="M223 45 L224.8 45 L218.8 53 L217 53 Z" fill="#ffffff" opacity="0.12"/>
                  </g>
                  <path d="M212 46.6 L212.3 51.9" stroke="#e6ecea" strokeWidth="0.95"/>
                  <path d="M219 46.6 L221 51.8" stroke="#e6ecea" strokeWidth="0.95"/>
                  <path d="M207.4 52.5 L228.4 52.3" stroke="#b7c2be" strokeWidth="0.4" opacity="0.8"/>

                  {/* Cabin door with handle */}
                  <rect x="193.4" y="46.2" width="5.4" height="11" rx="1.7" fill="none" stroke="#a3b1ac" strokeWidth="0.55"/>
                  <circle cx="197.4" cy="52" r="0.45" fill="#7d8b87"/>

                  {/* Large oval cabin windows: frame, glass, reflection */}
                  <g>
                  <g fill="#d3dbd8">
                  <ellipse cx="111" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="120.2" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="129.4" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="138.6" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="147.8" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="157" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="166.2" cy="50.2" rx="2.9" ry="3.5"/><ellipse cx="175.4" cy="50.2" rx="2.9" ry="3.5"/>
                  </g>
                  <g fill="url(#subm-jet-glass)">
                  <ellipse cx="111" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="120.2" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="129.4" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="138.6" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="147.8" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="157" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="166.2" cy="50.2" rx="2.2" ry="2.8"/><ellipse cx="175.4" cy="50.2" rx="2.2" ry="2.8"/>
                  </g>
                  <g fill="#ffffff" opacity="0.45">
                  <ellipse cx="110.3" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="119.5" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="128.7" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="137.9" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="147.1" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="156.3" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="165.5" cy="49.1" rx="0.7" ry="1.1"/><ellipse cx="174.7" cy="49.1" rx="0.7" ry="1.1"/>
                  </g>
                  </g>

                  {/* Wing-to-body fairing */}
                  <path d="M100 62.6 C114 66.6 144 66.6 158 62.6 Z" fill="#c5cfcb"/>

                  {/* Wing (near side, swept, ends below the windows) */}
                  <path d="M157 61.4 L141 60.4 L103.4 58.6 C101.4 58.6 100.6 59.5 101.3 60.4 L104 61.6 L139 64.8 L155 65.2 Z" fill="url(#subm-jet-wing)" stroke="#869590" strokeWidth="0.45"/>
                  <path d="M155.6 61.6 L104 59.2" stroke="#ffffff" strokeWidth="0.55" opacity="0.8"/>
                  <path d="M139 64.2 L110 61.6" stroke="#7d8b87" strokeWidth="0.35" opacity="0.7"/>

                  {/* Engine: shadow on fuselage, pylon, nacelle, intake, nozzle */}
                  <ellipse cx="72" cy="51.4" rx="24" ry="3.4" fill="url(#subm-jet-shadow)"/>
                  <path d="M62 48.6 L84 48.4 L82 51.6 L65 51.8 Z" fill="#b4bfbb"/>
                  <path d="M91.2 37.4 C93.4 38.2 94.6 41 94.6 43.6 C94.6 46.2 93.4 49 91.2 49.8 L62.4 49.2 C59.4 49 57.4 47.8 56.4 46.4 L56.4 41 C57.4 39.6 59.4 38.4 62.4 38.2 Z" fill="url(#subm-jet-nacelle)"/>
                  <path d="M66.8 38.3 L66.8 49.3" stroke="#b9c4c0" strokeWidth="0.4"/>
                  <path d="M62.4 39.4 L90 39.2" stroke="#ffffff" strokeWidth="0.8" opacity="0.9" strokeLinecap="round"/>
                  <ellipse cx="92.8" cy="43.6" rx="2.2" ry="6.3" fill="#c9d2cf"/>
                  <ellipse cx="93" cy="43.6" rx="1.55" ry="5.4" fill="#1b2724"/>
                  <ellipse cx="93.3" cy="43.6" rx="0.7" ry="1.9" fill="#5d6a66"/>
                  <path d="M56.4 41.2 L51.4 42 C50.4 42.2 50 42.9 50 43.6 C50 44.3 50.4 45 51.4 45.2 L56.4 46.2 Z" fill="url(#subm-jet-nozzle)"/>
                  <path d="M51 42.8 L47.4 43.4 C47 43.5 47 43.9 47.4 44 L51 44.6 Z" fill="#4b5653"/>
                </svg>
            </div>
          )}

          {/* ----- TRAIN SPECIFIC DETAILS ----- */}
          {mode === 'TRAIN' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
              <svg width="220" height="120" viewBox="0 0 220 120" overflow="visible" aria-hidden="true">
                <defs>
                <linearGradient id="subm-train-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f6fbf9"/>
                <stop offset="0.45" stopColor="#E6F2F0"/>
                <stop offset="1" stopColor="#c6d9d3"/>
                </linearGradient>
                <linearGradient id="subm-train-green" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1a8f6b"/>
                <stop offset="0.5" stopColor="#0F6B52"/>
                <stop offset="1" stopColor="#0b5240"/>
                </linearGradient>
                <linearGradient id="subm-train-glass" x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0" stopColor="#4f6b69"/>
                <stop offset="0.45" stopColor="#1c2b2f"/>
                <stop offset="1" stopColor="#0e171a"/>
                </linearGradient>
                <radialGradient id="subm-train-lamp" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#ffffff"/>
                <stop offset="0.45" stopColor="#fff6d2" stopOpacity="0.85"/>
                <stop offset="1" stopColor="#fff6d2" stopOpacity="0"/>
                </radialGradient>
                <clipPath id="subm-train-body-clip">
                <path d="M0 0 L120 0 C180 0 210 40 220 90 L220 120 L0 120 Z"/>
                </clipPath>
                <clipPath id="subm-train-band-clip">
                <path d="M0 35 L130 35 C160 35 185 45 195 65 L175 65 C160 50 140 45 0 45 Z"/>
                </clipPath>
                </defs>

                {/* Tiny wheel sets peeking out under the skirt (drawn first so the body hides their tops) */}
                <g>
                  <rect x="24" y="117" width="30" height="5" rx="2" fill="#1d2523"/>
                  <rect x="150" y="117" width="30" height="5" rx="2" fill="#1d2523"/>
                  <g fill="#161c1b" stroke="#56615e" strokeWidth="0.7">
                    <circle cx="31" cy="121.4" r="4.4"/><circle cx="47" cy="121.4" r="4.4"/>
                    <circle cx="157" cy="121.4" r="4.4"/><circle cx="173" cy="121.4" r="4.4"/>
                  </g>
                  <g fill="#aab6b2">
                    <circle cx="31" cy="121.4" r="1.2"/><circle cx="47" cy="121.4" r="1.2"/>
                    <circle cx="157" cy="121.4" r="1.2"/><circle cx="173" cy="121.4" r="1.2"/>
                  </g>
                </g>

                {/* Body (original silhouette) */}
                <path d="M0 0 L120 0 C180 0 210 40 220 90 L220 120 L0 120 Z" fill="url(#subm-train-body)"/>

                {/* Roof band (original shape) + highlight */}
                <g clipPath="url(#subm-train-body-clip)">
                <path d="M-2 -4 L232 -4 L232 62 L213 59 C204 38 186 20 160 14.6 C146 12.6 130 12 120 12 L-2 12 Z" fill="url(#subm-train-green)"/>
                <path d="M0 2.2 L120 2.2 C152 2.2 172 8 186 18" fill="none" stroke="#ffffff" strokeWidth="1.1" opacity="0.35"/>
                </g>

                {/* Window band (original shape): side windows + curved windscreen */}
                <path d="M0 35 L130 35 C160 35 185 45 195 65 L175 65 C160 50 140 45 0 45 Z" fill="url(#subm-train-glass)"/>
                <g clipPath="url(#subm-train-band-clip)">
                <g stroke="#dcebe7" strokeWidth="1.8">
                <path d="M14 33 L14 47"/><path d="M28 33 L28 47"/><path d="M42 33 L42 47"/><path d="M56 33 L56 47"/>
                <path d="M84 33 L84 47"/><path d="M98 33 L98 47"/><path d="M112 33 L112 47"/><path d="M126 33 L126 47"/>
                </g>
                <path d="M141 32 L148 32 L148 50 L141 50 Z" fill="#dcebe7"/>
                <path d="M0 36.6 L130 36.6 C156 36.6 176 43 188 55" fill="none" stroke="#ffffff" strokeWidth="0.9" opacity="0.25"/>
                <path d="M160 40 L170 40 L184 66 L174 66 Z" fill="#ffffff" opacity="0.14"/>
                </g>

                {/* Mint accent line under the windows */}
                <path d="M0 49 L130 49 C150 49 165 55.6 177.4 69.4" fill="none" stroke="#7cc4ae" strokeWidth="1.4"/>

                {/* Door seams */}
                <g stroke="#a9c2bb" strokeWidth="0.8" fill="none">
                <path d="M62 14 L62 34 M62 46.6 L62 104"/><path d="M78 14 L78 34 M78 46.6 L78 104"/>
                </g>

                {/* Nose highlight + faint panel line */}
                <path d="M196 34 C206 50 213 68 217 86" fill="none" stroke="#ffffff" strokeWidth="1.4" opacity="0.5"/>

                {/* Headlight */}
                <path d="M205 84 L214.6 88.4 C215.6 89 215.4 90.2 214.2 90.2 L205.2 87.4 C204.2 87.1 204 84.2 205 84 Z" fill="#f6f9f8" stroke="#9ab3ac" strokeWidth="0.5"/>
                <ellipse cx="211.6" cy="88.2" rx="6" ry="3.2" fill="url(#subm-train-lamp)" opacity="0.7"/>

                {/* Bottom band / skirt (original shape) */}
                <g clipPath="url(#subm-train-body-clip)">
                <rect x="-2" y="104" width="234" height="20" fill="url(#subm-train-green)"/>
                <path d="M0 104.8 L230 104.8" stroke="#ffffff" strokeWidth="0.8" opacity="0.3"/>
                <path d="M0 118.4 L230 118.4" stroke="#083d30" strokeWidth="2.4" opacity="0.6"/>
                </g>
              </svg>
            </div>
          )}

          {/* ----- CLAIM/DRONE SPECIFIC DETAILS ----- */}
          {mode === 'CLAIM' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
              <svg width="140" height="90" viewBox="0 0 140 90" overflow="visible">
                <path d="M 20 45 C 50 25, 90 25, 120 45 L 110 55 C 90 40, 50 40, 30 55 Z" fill="#0F6B52" />
                <ellipse cx="70" cy="55" rx="30" ry="15" fill="#2E8B74" />
                <ellipse cx="70" cy="58" rx="20" ry="8" fill="#E6F2F0" opacity="0.9" />
                <path d="M 30 45 L 15 35" stroke="#0F6B52" strokeWidth="4" strokeLinecap="round" />
                <path d="M 110 45 L 125 35" stroke="#0F6B52" strokeWidth="4" strokeLinecap="round" />
                <g className="origin-[15px_35px] animate-[spin_0.1s_linear_infinite]">
                   <ellipse cx="15" cy="35" rx="24" ry="3" fill="#86A09F" opacity="0.6" />
                </g>
                <g className="origin-[125px_35px] animate-[spin_0.1s_linear_infinite]">
                   <ellipse cx="125" cy="35" rx="24" ry="3" fill="#86A09F" opacity="0.6" />
                </g>
                <circle cx="70" cy="70" r="6" fill="#0A5442" />
              </svg>
            </div>
          )}
        </div>

        {/* Wheels for BUS only (Separate from core so they can drop in and spin) */}
        {mode === 'BUS' && (
          <>
            <div 
              className="absolute bottom-[-10px] left-[29px] w-[30px] h-[30px] transition-all duration-500 z-20"
              style={{
                opacity: isVehiclePhase ? 1 : 0,
                transform: isVehiclePhase ? 'translateY(0)' : 'translateY(-20px)',
              }}
            >
              <div 
                className="w-full h-full rounded-full"
                style={{ animation: isDriving ? 'wheel-spin 0.3s linear infinite' : 'none' }}
              >
                <svg width="100%" height="100%" viewBox="0 0 40 40" aria-hidden="true">
                  <defs>
                  <radialGradient id="subm-bus-wheel-rear-rim" cx="0.42" cy="0.38" r="0.6">
                  <stop offset="0" stopColor="#f1f5f4"/>
                  <stop offset="0.6" stopColor="#c3cfcb"/>
                  <stop offset="1" stopColor="#8b9a96"/>
                  </radialGradient>
                  </defs>
                  <circle cx="20" cy="20" r="19" fill="#1c2322"/>
                  <circle cx="20" cy="20" r="17.2" fill="none" stroke="#2c3533" strokeWidth="1.4"/>
                  <circle cx="20" cy="20" r="11" fill="url(#subm-bus-wheel-rear-rim)"/>
                  <circle cx="20" cy="20" r="11" fill="none" stroke="#0F6B52" strokeWidth="1.4"/>
                  <circle cx="20" cy="20" r="4" fill="#5f6d69"/>
                  <g fill="#3f4a47">
                  <circle cx="20" cy="13.4" r="1.2"/><circle cx="26.3" cy="18" r="1.2"/><circle cx="23.9" cy="25.3" r="1.2"/><circle cx="16.1" cy="25.3" r="1.2"/><circle cx="13.7" cy="18" r="1.2"/>
                  </g>
                </svg>
              </div>
            </div>

            <div 
              className="absolute bottom-[-10px] right-[55px] w-[30px] h-[30px] transition-all duration-500 z-20 delay-75"
              style={{
                opacity: isVehiclePhase ? 1 : 0,
                transform: isVehiclePhase ? 'translateY(0)' : 'translateY(-20px)',
              }}
            >
              <div 
                className="w-full h-full rounded-full"
                style={{ animation: isDriving ? 'wheel-spin 0.3s linear infinite' : 'none' }}
              >
                <svg width="100%" height="100%" viewBox="0 0 40 40" aria-hidden="true">
                  <defs>
                  <radialGradient id="subm-bus-wheel-front-rim" cx="0.42" cy="0.38" r="0.6">
                  <stop offset="0" stopColor="#f1f5f4"/>
                  <stop offset="0.6" stopColor="#c3cfcb"/>
                  <stop offset="1" stopColor="#8b9a96"/>
                  </radialGradient>
                  </defs>
                  <circle cx="20" cy="20" r="19" fill="#1c2322"/>
                  <circle cx="20" cy="20" r="17.2" fill="none" stroke="#2c3533" strokeWidth="1.4"/>
                  <circle cx="20" cy="20" r="11" fill="url(#subm-bus-wheel-front-rim)"/>
                  <circle cx="20" cy="20" r="11" fill="none" stroke="#0F6B52" strokeWidth="1.4"/>
                  <circle cx="20" cy="20" r="4" fill="#5f6d69"/>
                  <g fill="#3f4a47">
                  <circle cx="20" cy="13.4" r="1.2"/><circle cx="26.3" cy="18" r="1.2"/><circle cx="23.9" cy="25.3" r="1.2"/><circle cx="16.1" cy="25.3" r="1.2"/><circle cx="13.7" cy="18" r="1.2"/>
                  </g>
                </svg>
              </div>
            </div>
          </>
        )}

        {/* Trail Effects (Only when driving) */}
        {isDriving && mode === 'FLIGHT' && (
          <div className="absolute top-1/2 left-0 -translate-y-1/2 z-0 w-full h-full pointer-events-none">
            {/* Speed lines */}
            <div className="w-24 h-1 bg-white/50 rounded-full absolute top-[20%] left-[-20px] animate-[particle-rush_0.4s_infinite]" />
            <div className="w-16 h-1.5 bg-white/40 rounded-full absolute top-[60%] left-[-40px] animate-[particle-rush_0.5s_infinite_0.1s]" />
            
            {/* Clouds */}
            <svg className="absolute top-[0%] left-[-60px] animate-[cloud-rush_0.6s_infinite] text-white/70 drop-shadow-md" width="60" height="40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.5 19c-2.485 0-4.5-2.015-4.5-4.5 0-.175.012-.346.033-.513A5.498 5.498 0 018.5 10c-2.85 0-5.184 2.186-5.474 4.975A3.5 3.5 0 000 18.5 3.5 3.5 0 003.5 22h14c2.485 0 4.5-2.015 4.5-4.5S19.985 19 17.5 19z"/>
            </svg>
            <svg className="absolute top-[60%] left-[-20px] animate-[cloud-rush_0.7s_infinite_0.2s] text-white/60 drop-shadow-md" width="45" height="30" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.5 19c-2.485 0-4.5-2.015-4.5-4.5 0-.175.012-.346.033-.513A5.498 5.498 0 018.5 10c-2.85 0-5.184 2.186-5.474 4.975A3.5 3.5 0 000 18.5 3.5 3.5 0 003.5 22h14c2.485 0 4.5-2.015 4.5-4.5S19.985 19 17.5 19z"/>
            </svg>

            {/* Sparkles / Debris */}
            <div className="w-2.5 h-2.5 bg-amber-300 rounded-full absolute top-[30%] left-[10px] animate-[particle-rush_0.3s_infinite_0.1s]" />
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full absolute top-[80%] left-[-20px] animate-[particle-rush_0.4s_infinite_0.3s]" />
          </div>
        )}

        {isDriving && mode !== 'FLIGHT' && (
          <div className="absolute bottom-0 left-0 z-0 pointer-events-none">
             {/* Dust clouds kicking up on ground */}
             <div className="w-12 h-12 bg-white/40 rounded-full blur-md absolute -bottom-4 left-[-30px] animate-[dust-trail_0.6s_infinite]" />
             <div className="w-10 h-10 bg-white/40 rounded-full blur-md absolute -bottom-2 left-[-10px] animate-[dust-trail_0.6s_infinite_0.2s]" />
             
             {/* High speed horizontal particles rushing past */}
             <div className="w-12 h-1 bg-slate-200/70 rounded-full absolute bottom-[40px] left-[-20px] animate-[particle-rush_0.3s_infinite]" />
             <div className="w-4 h-1.5 bg-amber-400/90 rounded-full absolute bottom-[20px] left-[10px] animate-[particle-rush_0.4s_infinite_0.1s]" />
             <div className="w-2 h-2 bg-emerald-400/90 rounded-full absolute bottom-[60px] left-[-10px] animate-[particle-rush_0.3s_infinite_0.2s]" />
          </div>
        )}

      </div>

      {/* Exhaust smoke. Rendered outside the moving wrapper so the puffs stay where they were
          released while the bus pulls away; anchored to the tailpipe's on-screen spot during the
          wind-up (wrapper at translateX(90px), bus 220x85 centred, pipe at x=2/y=77 of the bus). */}
      {mode === 'BUS' && (isAnticipation || isDriving) && (
        <div
          className="pointer-events-none absolute z-[201]"
          style={{ left: 'calc(50% - 18px)', top: 'calc(50% + 34.5px)' }}
        >
          {[0, 0.12, 0.24, 0.4, 0.55, 0.7, 0.85].map((delay, i) => (
            <span
              key={delay}
              className="absolute block rounded-full blur-[3px]"
              style={{
                width: 16 + (i % 3) * 4,
                height: 16 + (i % 3) * 4,
                left: -8,
                top: -8,
                background: 'rgba(148, 163, 184, 0.6)',
                animation: `exhaust-puff 1s ease-out ${delay}s both`,
              }}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
