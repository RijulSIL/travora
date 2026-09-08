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
      },
      animation: {
        'float-complex': 'float-complex 8s ease-in-out infinite',
        'gradient-xy': 'gradient-xy 15s ease infinite',
        'slide-up-fade': 'slide-up-fade 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
        'shimmer': 'shimmer 2s infinite linear',
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
