import React from 'react';

// A helper to generate a 3D Cuboid purely out of CSS
const Cuboid = ({ w, h, d, colors, className = '', style = {} }) => {
  return (
    <div 
      className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${className}`} 
      style={{ width: w, height: h, transformStyle: 'preserve-3d', ...style }}
    >
      {/* Front */}
      <div className={`absolute border border-black/5 ${colors.front || colors.all}`} style={{ width: w, height: h, transform: `translateZ(${d/2}px)` }} />
      {/* Back */}
      <div className={`absolute border border-black/5 ${colors.back || colors.all}`} style={{ width: w, height: h, transform: `rotateY(180deg) translateZ(${d/2}px)` }} />
      {/* Right */}
      <div className={`absolute border border-black/5 ${colors.right || colors.all}`} style={{ width: d, height: h, left: (w - d)/2, transform: `rotateY(90deg) translateZ(${w/2}px)` }} />
      {/* Left */}
      <div className={`absolute border border-black/5 ${colors.left || colors.all}`} style={{ width: d, height: h, left: (w - d)/2, transform: `rotateY(-90deg) translateZ(${w/2}px)` }} />
      {/* Top */}
      <div className={`absolute border border-black/5 ${colors.top || colors.all}`} style={{ width: w, height: d, top: (h - d)/2, transform: `rotateX(90deg) translateZ(${h/2}px)` }} />
      {/* Bottom */}
      <div className={`absolute border border-black/5 ${colors.bottom || colors.all}`} style={{ width: w, height: d, top: (h - d)/2, transform: `rotateX(-90deg) translateZ(${h/2}px)` }} />
    </div>
  );
};

export default function Vehicle3D({ mode }) {
  // Give it some base 3D perspective and an idle spin so we can see the 3D depth
  const containerStyle = {
    perspective: '1200px',
    transformStyle: 'preserve-3d'
  };
  
  const objectStyle = {
    transformStyle: 'preserve-3d',
    animation: 'spin3d 4s linear infinite',
  };

  // 1. Plane (Fuselage + Wings + Tail)
  if (mode === 'FLIGHT') {
    const planeColors = {
      all: 'bg-white shadow-inner',
      right: 'bg-slate-100', left: 'bg-slate-200', top: 'bg-white', bottom: 'bg-slate-300'
    };
    const accentColors = {
      all: 'bg-brand shadow-inner',
      right: 'bg-brand', left: 'bg-[#2A2A80]', top: 'bg-[#4B4BBF]', bottom: 'bg-[#1D1D59]'
    };
    return (
      <div className="w-64 h-64 flex items-center justify-center relative" style={containerStyle}>
        <div className="w-full h-full relative" style={objectStyle}>
          {/* Fuselage */}
          <Cuboid w={160} h={30} d={30} colors={planeColors} />
          {/* Wings */}
          <Cuboid w={40} h={6} d={160} colors={planeColors} style={{ transform: 'translateX(-10px)' }} />
          {/* Tail */}
          <Cuboid w={30} h={40} d={6} colors={accentColors} style={{ transform: 'translate(-65px, -20px)' }} />
          <Cuboid w={20} h={5} d={50} colors={accentColors} style={{ transform: 'translate(-65px, -5px)' }} />
        </div>
      </div>
    );
  }

  // 2. Train (Sleek Bullet Train Cuboids)
  if (mode === 'TRAIN') {
    const bodyColors = {
      front: 'bg-slate-800', back: 'bg-slate-900', left: 'bg-slate-700', right: 'bg-slate-800', top: 'bg-slate-600', bottom: 'bg-slate-900'
    };
    const stripeColors = {
      all: 'bg-emerald-500'
    };
    return (
      <div className="w-64 h-64 flex items-center justify-center relative" style={containerStyle}>
        <div className="w-full h-full relative" style={objectStyle}>
          {/* Main Body */}
          <Cuboid w={180} h={40} d={40} colors={bodyColors} />
          {/* Stripe / Windows */}
          <Cuboid w={182} h={10} d={42} colors={stripeColors} style={{ transform: 'translateY(-5px)' }} />
          {/* Nose Cone (simplified as a smaller block at the front) */}
          <Cuboid w={30} h={25} d={30} colors={bodyColors} style={{ transform: 'translate(95px, 7px)' }} />
        </div>
      </div>
    );
  }

  // 3. Bus (Blocky Transit)
  if (mode === 'BUS') {
    const busColors = {
      front: 'bg-amber-400', back: 'bg-amber-500', left: 'bg-amber-300', right: 'bg-amber-400', top: 'bg-amber-200', bottom: 'bg-amber-600'
    };
    const windowColors = {
      all: 'bg-slate-900'
    };
    return (
      <div className="w-64 h-64 flex items-center justify-center relative" style={containerStyle}>
        <div className="w-full h-full relative" style={objectStyle}>
          {/* Main Body */}
          <Cuboid w={140} h={50} d={45} colors={busColors} />
          {/* Windows Wrap */}
          <Cuboid w={142} h={20} d={47} colors={windowColors} style={{ transform: 'translateY(-10px)' }} />
          {/* Wheels */}
          <Cuboid w={25} h={15} d={50} colors={{all: 'bg-zinc-800'}} style={{ transform: 'translate(-40px, 25px)' }} />
          <Cuboid w={25} h={15} d={50} colors={{all: 'bg-zinc-800'}} style={{ transform: 'translate(40px, 25px)' }} />
        </div>
      </div>
    );
  }

  // 4. Default / FileText (Digital Document)
  const docColors = {
    front: 'bg-white', back: 'bg-slate-100', left: 'bg-slate-200', right: 'bg-slate-100', top: 'bg-white', bottom: 'bg-slate-300'
  };
  return (
    <div className="w-64 h-64 flex items-center justify-center relative" style={containerStyle}>
      <div className="w-full h-full relative" style={objectStyle}>
        <Cuboid w={100} h={140} d={5} colors={docColors} />
        {/* Lines on the document */}
        <Cuboid w={60} h={4} d={7} colors={{all: 'bg-brand'}} style={{ transform: 'translate(-10px, -40px)' }} />
        <Cuboid w={80} h={4} d={7} colors={{all: 'bg-slate-300'}} style={{ transform: 'translate(0px, -20px)' }} />
        <Cuboid w={70} h={4} d={7} colors={{all: 'bg-slate-300'}} style={{ transform: 'translate(-5px, 0px)' }} />
        <Cuboid w={80} h={4} d={7} colors={{all: 'bg-emerald-400'}} style={{ transform: 'translate(0px, 40px)' }} />
      </div>
    </div>
  );
}
