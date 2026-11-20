/*
 * Left half of every sign-in screen (sign in, forgot / reset password, first-sign-in password):
 * the travel photo with the Travora logo leading the tagline at the bottom. Hidden below lg, where
 * each page shows the logo above its form instead (AuthMobileLogo).
 */
export default function AuthBrandPanel() {
  return (
    <div className="relative hidden w-1/2 lg:block overflow-hidden">
      <img
        src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?q=80&w=2074&auto=format&fit=crop"
        alt="Corporate Travel"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-10000 hover:scale-105"
      />
      <div className="absolute inset-0 bg-brand/60 mix-blend-multiply" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent" />

      <div className="absolute bottom-16 left-16 right-16 flex flex-col items-start gap-7 text-white">
        {/* Shown all white: the logo's own dark green "Enterprise Portal" line vanishes on the photo.
            -ml-2 / -mb-4 offset the PNG's transparent margins so it lines up with the heading and
            sits close to the line below it. */}
        <img
          src="/assets/travora-si-logo.png"
          alt="Travora SI Enterprise Portal"
          className="-mb-4 -ml-2 block h-20 w-auto max-w-full object-contain object-left brightness-0 invert xl:h-28"
        />
        <div className="h-[3px] w-[72px] rounded-full bg-white/50" />
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight mb-4 leading-tight">Simplify Your Corporate Travel & Expenses</h2>
          <p className="text-lg text-white/80 font-medium leading-relaxed max-w-xl">
            Experience a seamless, unified platform for booking trips, managing approvals, and settling reimbursements instantly. Built for the modern
            enterprise.
          </p>
        </div>
      </div>
    </div>
  );
}

/* The logo above the form on phones and narrow windows, where the photo panel is hidden. */
export function AuthMobileLogo() {
  return <img src="/assets/travora-si-logo.png" alt="Travora SI Enterprise Portal" className="mb-8 h-16 w-auto object-contain lg:hidden" />;
}
