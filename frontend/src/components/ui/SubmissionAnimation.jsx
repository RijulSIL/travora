import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
      coreRadius = '16px 32px 12px 16px';
      coreBg = '#0F6B52';
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
            <h3 className="font-bold text-[#0F6B52] text-[18px] mb-1 tracking-tight">
              {mode === 'BUS' ? '🚌' : mode === 'TRAIN' ? '🚆' : mode === 'FLIGHT' ? '✈' : '🧾'} Request Submitted
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
            boxShadow: (!isVehiclePhase || mode === 'BUS') ? '0 25px 50px -12px rgba(0, 0, 0, 0.25)' : 'none',
            overflow: (!isVehiclePhase || mode === 'BUS') ? 'hidden' : 'visible'
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
              <div className="absolute top-3 left-4 right-8 h-10 bg-[#E6F2F0]/90 rounded-lg flex items-center shadow-inner border-b-2 border-emerald-800">
                <div className="w-1/2 h-full border-r-2 border-[#0F6B52]" />
              </div>
              <div className="absolute bottom-4 right-2 w-3 h-4 bg-amber-200 rounded-sm shadow-[10px_0_15px_rgba(253,230,138,0.8)]" />
              <div className="absolute bottom-4 left-0 w-2 h-3 bg-red-500 rounded-r-sm" />
              <div className="absolute top-[52px] left-6 w-16 h-3 bg-emerald-900 rounded-[2px] flex items-center justify-center">
                <div className="w-12 h-1 bg-emerald-400/50 rounded-full animate-pulse" />
              </div>
            </div>
          )}

          {/* ----- FLIGHT SPECIFIC DETAILS ----- */}
          {mode === 'FLIGHT' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
              <svg width="240" height="90" viewBox="0 0 240 90" overflow="visible">
                <defs>
                  <linearGradient id="planeBody" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="60%" stopColor="#F1F5F9" />
                    <stop offset="100%" stopColor="#CBD5E1" />
                  </linearGradient>
                  <filter id="engineGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Tail */}
                <path d="M 25 45 L 10 10 C 8 5, 15 5, 22 10 L 60 45 Z" fill="#0F6B52" />
                <path d="M 22 10 L 60 45 L 50 45 L 15 10 Z" fill="#0A5442" opacity="0.4" />

                {/* Fuselage */}
                <path d="M 10 45 L 200 45 C 225 45, 235 52, 235 58 C 235 65, 220 70, 200 70 L 15 70 C 5 70, 0 65, 0 58 C 0 52, 5 45, 10 45 Z" fill="url(#planeBody)" />
                
                {/* Livery Stripe */}
                <path d="M 0 58 L 235 58 L 225 62 L 5 62 Z" fill="#0F6B52" />
                
                {/* Cockpit Window */}
                <path d="M 195 48 L 215 48 C 220 48, 225 50, 228 54 L 200 54 Z" fill="#0F172A" />
                
                {/* Passenger Windows */}
                <line x1="50" y1="53" x2="180" y2="53" stroke="#0F172A" strokeWidth="3" strokeDasharray="4 6" strokeLinecap="round" opacity="0.7" />

                {/* Engine (Background/Right) */}
                <rect x="115" y="66" width="28" height="12" rx="6" fill="#64748B" />

                {/* Main Wing */}
                <path d="M 110 65 L 160 65 L 130 90 C 125 92, 115 92, 110 90 L 80 85 Z" fill="#CBD5E1" />
                
                {/* Engine (Foreground/Left) */}
                <rect x="100" y="68" width="34" height="14" rx="7" fill="#475569" />
                <rect x="100" y="68" width="10" height="14" rx="5" fill="#334155" />
                <ellipse cx="98" cy="75" rx="6" ry="3" fill="#38BDF8" filter="url(#engineGlow)" className="animate-pulse" />
              </svg>
            </div>
          )}

          {/* ----- TRAIN SPECIFIC DETAILS ----- */}
          {mode === 'TRAIN' && (
            <div 
              className="absolute inset-0 transition-opacity duration-500 delay-100"
              style={{ opacity: isVehiclePhase ? 1 : 0 }}
            >
              <svg width="220" height="120" viewBox="0 0 220 120" overflow="visible">
                <path d="M 0 0 L 120 0 C 180 0, 210 40, 220 90 L 220 120 L 0 120 Z" fill="#E6F2F0" />
                <path d="M 0 0 L 120 0 C 160 0, 185 10, 200 30 L 180 30 C 160 15, 120 12, 0 12 Z" fill="#0F6B52" />
                <path d="M 0 104 L 217 104 L 220 120 L 0 120 Z" fill="#0F6B52" />
                <path d="M 0 35 L 130 35 C 160 35, 185 45, 195 65 L 175 65 C 160 50, 140 45, 0 45 Z" fill="#0A5442" opacity="0.9" />
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
              className="absolute -bottom-4 left-6 w-10 h-10 transition-all duration-500 z-20"
              style={{
                opacity: isVehiclePhase ? 1 : 0,
                transform: isVehiclePhase ? 'translateY(0)' : 'translateY(-20px)',
              }}
            >
              <div 
                className="w-full h-full rounded-full border-[5px] border-[#0A5442] bg-slate-800 shadow-md"
                style={{ animation: isDriving ? 'wheel-spin 0.3s linear infinite' : 'none' }}
              >
                <div className="w-3 h-3 bg-slate-400 rounded-full m-2" />
              </div>
            </div>

            <div 
              className="absolute -bottom-4 right-8 w-10 h-10 transition-all duration-500 z-20 delay-75"
              style={{
                opacity: isVehiclePhase ? 1 : 0,
                transform: isVehiclePhase ? 'translateY(0)' : 'translateY(-20px)',
              }}
            >
              <div 
                className="w-full h-full rounded-full border-[5px] border-[#0A5442] bg-slate-800 shadow-md"
                style={{ animation: isDriving ? 'wheel-spin 0.3s linear infinite' : 'none' }}
              >
                <div className="w-3 h-3 bg-slate-400 rounded-full m-2" />
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
    </div>,
    document.body
  );
}
