import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function AccessDenied() {
  const [staticNoise, setStaticNoise] = useState('');

  useEffect(() => {
    // Generate simple static noise base64 for the screen
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    
    const generateStatic = () => {
      const imgData = ctx.createImageData(100, 100);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const color = Math.random() > 0.5 ? 255 : 0;
        imgData.data[i] = color;
        imgData.data[i+1] = color;
        imgData.data[i+2] = color;
        imgData.data[i+3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      setStaticNoise(canvas.toDataURL());
    };
    
    generateStatic();
    const interval = setInterval(generateStatic, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      
      <div className="relative w-[500px] h-[400px] flex items-end justify-center">
        
        {/* Giant Background Text */}
        <div className="absolute top-0 left-0 w-full text-center z-0 pointer-events-none">
          <span className="text-[250px] leading-none font-serif tracking-tighter text-gray-400 font-normal transform scale-y-[2.5] -translate-y-16 inline-block opacity-80">
            403
          </span>
        </div>

        {/* TV Assembly */}
        <div className="relative z-10 flex flex-col items-center">
          
          {/* Antennas & Dome */}
          <div className="relative w-32 h-24 mb-[-10px] z-0">
            {/* Left Antenna */}
            <div className="absolute bottom-6 left-1/2 w-1 h-24 bg-gray-700 origin-bottom -rotate-[35deg] border border-black z-10">
              <div className="absolute -top-3 -left-2 w-4 h-4 bg-gray-400 rounded-full border-2 border-black"></div>
            </div>
            {/* Right Antenna */}
            <div className="absolute bottom-6 left-1/2 w-1 h-20 bg-gray-700 origin-bottom rotate-[45deg] border border-black z-10">
              <div className="absolute -top-3 -left-2 w-4 h-4 bg-gray-400 rounded-full border-2 border-black"></div>
            </div>

            {/* Orange Dome */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 h-12 bg-[#F28C28] rounded-t-full border-2 border-black overflow-hidden z-20 shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.3)]">
              {/* Highlight */}
              <div className="absolute top-2 left-4 w-6 h-3 bg-white/40 rounded-full rotate-[-20deg]"></div>
            </div>
          </div>

          {/* TV Main Box */}
          <div className="relative bg-[#D97725] w-[400px] h-[220px] rounded-2xl border-2 border-black p-3 flex shadow-[inset_0_-10px_20px_rgba(0,0,0,0.4)] z-10">
            
            {/* CRT Screen Section */}
            <div className="flex-1 bg-black rounded-xl border-2 border-black p-2 relative shadow-inner overflow-hidden flex items-center justify-center">
              {/* Static Background */}
              {staticNoise && (
                <div 
                  className="absolute inset-0 opacity-80" 
                  style={{ backgroundImage: `url(${staticNoise})`, backgroundSize: '150px 150px' }}
                ></div>
              )}
              
              {/* Screen Inner Shadow/Bezel */}
              <div className="absolute inset-0 shadow-[inset_0_0_20px_rgba(0,0,0,1)] z-10 pointer-events-none rounded-xl"></div>
              
              {/* Not Found Label */}
              <div className="bg-black border border-blue-400 px-4 py-1 z-20 shadow-lg">
                <span className="text-blue-100 font-serif text-lg font-bold tracking-wider" style={{ textShadow: '1px 1px 0 #000' }}>
                  ACCESS DENIED
                </span>
              </div>
            </div>

            {/* Control Panel (Right Side) */}
            <div className="w-24 ml-2 flex flex-col items-center justify-between py-2">
              {/* Dials */}
              <div className="flex flex-col gap-3">
                <div className="w-12 h-12 rounded-full bg-[#8B5A2B] border-2 border-black shadow-[inset_2px_2px_5px_rgba(255,255,255,0.3),_2px_2px_4px_rgba(0,0,0,0.5)] relative">
                  <div className="absolute top-1 left-1/2 w-1 h-4 bg-black rounded-full rotate-45 origin-bottom"></div>
                </div>
                <div className="w-12 h-12 rounded-full bg-[#8B5A2B] border-2 border-black shadow-[inset_2px_2px_5px_rgba(255,255,255,0.3),_2px_2px_4px_rgba(0,0,0,0.5)] relative">
                  <div className="absolute top-1 left-1/2 w-1 h-4 bg-black rounded-full rotate-[-30deg] origin-bottom"></div>
                </div>
              </div>

              {/* Small buttons */}
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#8B5A2B] border border-black shadow-sm"></div>
                <div className="w-3 h-3 rounded-full bg-[#8B5A2B] border border-black shadow-sm"></div>
                <div className="w-3 h-3 rounded-full bg-[#8B5A2B] border border-black shadow-sm"></div>
              </div>

              {/* Speaker Slots */}
              <div className="flex flex-col gap-1 w-12">
                <div className="h-1 bg-black rounded-full w-full"></div>
                <div className="h-1 bg-black rounded-full w-full"></div>
              </div>
            </div>
          </div>
          
          {/* Feet & Ground Line */}
          <div className="w-full relative h-6">
            {/* Left Foot */}
            <div className="absolute top-0 left-8 w-12 h-6 bg-gray-700 border-2 border-black z-0"></div>
            {/* Right Foot */}
            <div className="absolute top-0 right-8 w-12 h-6 bg-gray-700 border-2 border-black z-0"></div>
            {/* Ground Line */}
            <div className="absolute bottom-0 -left-12 -right-12 h-1 bg-black z-20"></div>
          </div>
        </div>
      </div>
      
      <Link 
        to="/dashboard" 
        className="group mt-16 px-10 py-4 bg-[#D97725] hover:bg-[#E88936] text-white border-[3px] border-black font-black uppercase tracking-[0.2em] text-xl transition-all rounded-full shadow-[0_6px_0_0_#000] hover:-translate-y-1 hover:shadow-[0_8px_0_0_#000] active:translate-y-[6px] active:shadow-none flex items-center gap-4"
      >
        <div className="w-4 h-4 rounded-full bg-red-500 group-hover:bg-green-500 transition-colors duration-300 border border-black shadow-[inset_1px_1px_2px_rgba(255,255,255,0.4)] animate-pulse"></div>
        RETURN TO BASE
      </Link>
    </main>
  );
}
