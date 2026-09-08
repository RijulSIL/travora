import { Plane, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const ReceiptContent = ({ employeeName, destination, date }) => {
  return (
    <div className="w-[240px] h-[320px] p-5 flex flex-col bg-white rounded-md shadow-sm relative overflow-hidden transition-all duration-300">
        {/* Paper Grain Overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}></div>
        
        {/* Header - Stays at top */}
        <div className="relative z-10 border-b border-dashed border-slate-300 pb-3 mb-2 text-center">
            <div className="w-8 h-8 mx-auto mb-2 bg-emerald-100 rounded-full flex items-center justify-center shadow-inner">
                <Plane size={16} className="text-emerald-600" />
            </div>
            <div className="text-emerald-800 font-black text-sm tracking-widest uppercase">Travel Request</div>
        </div>

        <div className="mt-8"></div>

        {/* Dynamic Data */}
        <div className="relative z-10 text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide font-semibold">Employee</div>
        <div className="relative z-10 text-sm text-slate-800 font-bold mb-3">{employeeName || 'John Smith'}</div>
        
        <div className="relative z-10 text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide font-semibold">Destination</div>
        <div className="relative z-10 text-sm text-slate-800 font-bold mb-3">{destination || 'Singapore'}</div>
        
        <div className="relative z-10 text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide font-semibold">Date</div>
        <div className="relative z-10 text-sm text-slate-800 font-bold">{date || '2024-12-01'}</div>

        {/* Subtle Bottom Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-gradient-to-r from-emerald-400 to-emerald-500 opacity-20"></div>
    </div>
  );
};

export default function OrigamiAnimation({ onComplete, employeeName, destination, date }) {
  const [phase, setPhase] = useState('idle');

  useEffect(() => {
      // Scale down root container
      const root = document.getElementById('root') || document.body;
      const originalTransition = root.style.transition;
      const originalTransform = root.style.transform;
      
      root.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
      root.style.transform = 'scale(0.98)';
      
      // 1. Entrance (0.4s)
      setTimeout(() => setPhase('entrance'), 50);

      // 2. Transform morph (0.5s)
      setTimeout(() => setPhase('transform'), 450);

      // 3. Hero float (0.2s)
      setTimeout(() => setPhase('hero'), 950);

      // 4. Flight (1.0s)
      setTimeout(() => setPhase('flight'), 1150);

      // 5. Success (0.7s)
      setTimeout(() => {
          setPhase('success');
          // Restore root scale early during success
          root.style.transform = originalTransform;
      }, 2150);

      // 6. Complete
      setTimeout(() => {
        root.style.transition = originalTransition;
        root.style.transform = originalTransform;
        if (onComplete) onComplete();
      }, 2850);

      return () => {
          root.style.transition = originalTransition;
          root.style.transform = originalTransform;
      };
  }, [onComplete]);

  return createPortal(
    <div className={`fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center overflow-hidden perspective-[1200px] is-${phase}`}>
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-slate-900/60 transition-all duration-500
          ${(phase !== 'idle' && phase !== 'success') ? 'backdrop-blur-md opacity-100' : 'backdrop-blur-none opacity-0'}
        `}
      />

      <style>{`
         .preserve-3d {
            transform-style: preserve-3d;
         }

         /* --- Global Rig --- */
         .animation-rig {
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease;
            transform: translateY(100px) scale(0.9);
            opacity: 0;
         }
         
         .is-entrance .animation-rig {
            transform: translateY(0) scale(1.05);
            opacity: 1;
         }

         .is-transform .animation-rig {
            /* Quick upward rotation & slight scale down during transformation */
            transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform: rotateX(10deg) rotate(-10deg) translateY(-20px) scale(0.9);
            opacity: 1;
         }

         .is-hero .animation-rig {
            /* Tiny wing tilt and float */
            transition: transform 0.2s cubic-bezier(0.25, 1, 0.5, 1);
            transform: rotateX(15deg) rotate(-5deg) scale(0.9) translateY(-25px);
            opacity: 1;
         }

         .is-flight .animation-rig {
            /* Graceful curved path, banking right */
            transition: transform 1.0s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease 0.7s;
            transform: translate(80vw, -80vh) rotate(25deg) scale(0.4);
            opacity: 0;
         }

         .is-success .animation-rig {
             opacity: 0;
             display: none;
         }

         /* --- Morphing Elements --- */
         .morph-receipt, .morph-airplane {
            position: absolute;
            top: 50%;
            left: 50%;
            transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
         }
         
         .morph-receipt {
            margin-top: -160px;
            margin-left: -120px;
         }

         .morph-airplane {
            /* Center the airplane icon appropriately */
            margin-top: -60px; 
            margin-left: -60px;
            color: white;
            filter: drop-shadow(0 20px 25px rgba(0,0,0,0.3));
         }

         /* Initial State */
         .is-idle .morph-receipt, .is-entrance .morph-receipt {
            opacity: 1;
            transform: scale(1);
            filter: drop-shadow(0 25px 35px rgba(0,0,0,0.2)) blur(0px);
            border-radius: 6px;
         }
         .is-idle .morph-airplane, .is-entrance .morph-airplane {
            opacity: 0;
            transform: scaleX(0.2) scaleY(0.6) translateY(40px);
            filter: blur(4px);
         }

         /* Transform State (Crossfade happens rapidly during the flip) */
         .is-transform .morph-receipt {
            opacity: 0;
            transform: scaleX(0.2) scaleY(0.6) translateY(-40px);
            filter: blur(4px);
            border-radius: 40px; 
         }
         .is-transform .morph-airplane, .is-hero .morph-airplane, .is-flight .morph-airplane {
            opacity: 1;
            transform: scaleX(1) scaleY(1) translateY(0);
            filter: blur(0px);
         }
         
         .is-hero .morph-receipt, .is-flight .morph-receipt {
            opacity: 0;
            display: none;
         }

         /* Success State */
         .success-msg {
            transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
            opacity: 0;
            transform: scale(0.9) translateY(20px);
         }

         .is-success .success-msg {
            opacity: 1;
            transform: scale(1) translateY(0);
         }
      `}</style>

      {/* Main Animation Rig */}
      <div className="animation-rig absolute inset-0 preserve-3d">
          {/* Receipt View */}
          <div className="morph-receipt">
              <ReceiptContent employeeName={employeeName} destination={destination} date={date} />
          </div>

          {/* Airplane View */}
          <div className="morph-airplane w-[140px] h-[140px]">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  {/* Right Wing (back) */}
                  <path d="M22 2L15 22L11 13L22 2Z" fill="#e2e8f0" />
                  {/* Left Wing (front) */}
                  <path d="M22 2L2 9L11 13L22 2Z" fill="#ffffff" />
                  {/* Fuselage shadow */}
                  <path d="M11 13L15 22L11 20L11 13Z" fill="#94a3b8" />
              </svg>
          </div>
      </div>

      {/* Success View */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="success-msg flex flex-col items-center bg-white p-6 rounded-2xl shadow-xl">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mb-3">
                  <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Claim Submitted</h3>
              <p className="text-sm text-slate-500 mt-1 text-center">Your travel request is flying towards approval.</p>
          </div>
      </div>

    </div>,
    document.body
  );
}
