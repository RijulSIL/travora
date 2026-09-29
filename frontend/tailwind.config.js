export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      keyframes: {
        'float-complex': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg) scale(1)' },
          '33%': { transform: 'translateY(-20px) rotate(5deg) scale(1.05)' },
          '66%': { transform: 'translateY(10px) rotate(-5deg) scale(0.95)' },
        },
        'gradient-xy': {
          '0%, 100%': { backgroundPosition: '0% 50%', backgroundSize: '400% 400%' },
          '50%': { backgroundPosition: '100% 50%', backgroundSize: '400% 400%' },
        },
        'slide-up-fade': {
          from: { opacity: '0', transform: 'translateY(40px) scale(0.9)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', boxShadow: '0 0 0 0 rgba(99, 102, 241, 0.7)' },
          '100%': { transform: 'scale(2.5)', boxShadow: '0 0 0 20px rgba(99, 102, 241, 0)' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // Trot from off-screen left up to the barn's wall — not a constant-speed slide: a couple
        // of tiny hesitations (a half-step back before catching up again) and a grazing pause in
        // the open field, so the ground covered per unit time isn't perfectly uniform. Linear
        // timing between stops keeps each individual step even; the unevenness comes from the
        // stops themselves. 52%-72% (the bush hop) is left untouched so the jump below still
        // lands exactly where it's tuned to.
        'sheep-walk': {
          '0%': { left: '-16%' },
          '9%': { left: '-2%' },
          '12%': { left: '-3%' },
          '17%': { left: '3%' },
          '29%': { left: '18%' },
          '33%': { left: '18%' },
          '40%': { left: '27%' },
          '52%': { left: '42%' },
          '72%': { left: '58%' },
          '77%': { left: '59%' },
          '85%': { left: '72%' },
          '90%': { left: '82%' },
          '100%': { left: '96%' },
        },
        // The hop over the bush (52%-72%) is unchanged. Everywhere else, a small continuous
        // bob/sway stands in for a body that's alive even when not airborne, and the two spots
        // where sheep-walk above pauses (12%, 77%) get a quick squash-and-rebound — the visual
        // beat of coming to a stop rather than just halting.
        'sheep-jump': {
          '0%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
          '6%': { transform: 'translateY(-1.5px) rotate(1deg) scale(1,1)' },
          '12%': { transform: 'translateY(1px) rotate(-0.5deg) scale(1.08,0.9)' },
          '15%': { transform: 'translateY(-2px) rotate(0.5deg) scale(0.96,1.05)' },
          '20%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
          '26%': { transform: 'translateY(-1.5px) rotate(-1deg) scale(1,1)' },
          '33%': { transform: 'translateY(0.5px) rotate(0.8deg) scale(1,1)' },
          '40%': { transform: 'translateY(-1.5px) rotate(-1deg) scale(1,1)' },
          '50%, 52%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
          '55%': { transform: 'translateY(3px) rotate(-3deg) scale(1.12,0.85)' },
          '58%': { transform: 'translateY(-40px) rotate(-10deg) scale(0.92,1.1)' },
          '60%': { transform: 'translateY(-63px) rotate(-4deg) scale(0.94,1.06)' },
          '62%': { transform: 'translateY(-70px) rotate(0deg) scale(0.95,1.05)' },
          '64%': { transform: 'translateY(-63px) rotate(4deg) scale(0.94,1.06)' },
          '66%': { transform: 'translateY(-40px) rotate(10deg) scale(0.92,1.1)' },
          '69%': { transform: 'translateY(3px) rotate(3deg) scale(1.12,0.85)' },
          '72%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
          '77%': { transform: 'translateY(1.5px) rotate(0.6deg) scale(1.1,0.9)' },
          '80%': { transform: 'translateY(-2px) rotate(-0.6deg) scale(0.96,1.05)' },
          '85%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
          '90%': { transform: 'translateY(-1.3px) rotate(1deg) scale(1,1)' },
          '96%': { transform: 'translateY(0.3px) rotate(-0.7deg) scale(1,1)' },
          '100%': { transform: 'translateY(0) rotate(0deg) scale(1,1)' },
        },
        // Independent, fast, short loops — not tied to the 6s walk clock — so the legs and head
        // keep cycling at a natural stepping pace regardless of how the body's own timeline is
        // stretched or paused. Front and back leg pairs swing in opposite phase (a simplified
        // diagonal trot) instead of the whole cluster translating as one rigid unit.
        'legs-step-front': {
          '0%, 100%': { transform: 'rotate(5deg)' },
          '50%': { transform: 'rotate(-5deg)' },
        },
        'legs-step-back': {
          '0%, 100%': { transform: 'rotate(-5deg)' },
          '50%': { transform: 'rotate(5deg)' },
        },
        'head-nod': {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        // Stays fully visible until right up against the barn wall, then shrinks and fades as if
        // slipping behind it.
        'sheep-enter': {
          '0%, 88%': { opacity: '1', transform: 'scale(1)' },
          '94%': { opacity: '0.72', transform: 'scale(0.84)' },
          '100%': { opacity: '0', transform: 'scale(0.66)' },
        },
        'legs-run': {
          '0%, 52%, 72%, 100%': { opacity: '1' },
          '57%, 67%': { opacity: '0' },
        },
        'legs-tuck': {
          '0%, 52%, 72%, 100%': { opacity: '0' },
          '57%, 67%': { opacity: '1' },
        },
      },
      animation: {
        'float-complex': 'float-complex 8s ease-in-out infinite',
        'gradient-xy': 'gradient-xy 15s ease infinite',
        'slide-up-fade': 'slide-up-fade 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'sheep-walk': 'sheep-walk 6s linear infinite',
        'sheep-jump': 'sheep-jump 6s ease-in-out infinite',
        'sheep-enter': 'sheep-enter 6s linear infinite',
        'legs-run': 'legs-run 6s ease-in-out infinite',
        'legs-tuck': 'legs-tuck 6s ease-in-out infinite',
        'legs-step-front': 'legs-step-front 0.42s ease-in-out infinite',
        'legs-step-back': 'legs-step-back 0.42s ease-in-out infinite',
        'head-nod': 'head-nod 0.68s ease-in-out infinite',
      },
      colors: {
        ink: '#17202a',
        line: '#d9dee7',
        brand: '#116149',
        accent: '#b55d17',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
