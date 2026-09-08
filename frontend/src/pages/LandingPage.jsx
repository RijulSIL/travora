import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Compass,
  CreditCard,
  ShieldCheck,
  Layers,
  FileCheck,
  Users,
  User,
  Building2,
  Sparkles,
  Coins,
  ArrowRight,
  ArrowDown,
  LogIn,
  ChevronDown,
  Shield,
  CheckCircle2,
  Clock,
  BarChart3,
  Zap,
} from 'lucide-react';


/* ── static data ── */
const STATS = [
  { value: '4-Stage', label: 'Approval Workflow' },
  { value: 'Real-time', label: 'SLA Tracking' },
  { value: 'GST-Ready', label: 'Invoice Validation' },
  { value: 'Multi-Role', label: 'Access Control' },
];

const AUDIENCES = [
  {
    label: 'Employees',
    detail: 'Submit claims and travel requests in one place. Get instant policy checks before you file.',
    icon: User,
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    label: 'Managers',
    detail: 'Approve with full context — policy compliance, SLA deadlines, and team spend visibility.',
    icon: Users,
    gradient: 'from-teal-500 to-emerald-600',
  },
  {
    label: 'HR & Payroll',
    detail: 'Handle exceptions, manage travel desk operations, and prepare payments seamlessly.',
    icon: Building2,
    gradient: 'from-green-500 to-emerald-600',
  },
  {
    label: 'Finance',
    detail: 'GST validation, audit logs, payment queues, and ERP-friendly ledger exports.',
    icon: Coins,
    gradient: 'from-emerald-600 to-teal-700',
  },
];

const FEATURES = [
  {
    title: 'Guided claims',
    body: 'City caps, categories, and policy hints while you draft — fewer rejections before first submit.',
    icon: Sparkles,
    accent: 'bg-emerald-500',
  },
  {
    title: 'Approval chain',
    body: 'Clear stages for managers, HR, payroll, and finance. Everyone sees status without chasing email.',
    icon: Layers,
    accent: 'bg-teal-500',
  },
  {
    title: 'Finance-ready',
    body: 'GST, payment queues, and reporting aligned with your ledger and compliance workflows.',
    icon: CreditCard,
    accent: 'bg-green-600',
  },
];

const WORKFLOW_STEPS = [
  { num: '01', title: 'Draft & Submit', desc: 'Create claims with auto policy checks', icon: FileCheck },
  { num: '02', title: 'Multi-Stage Review', desc: 'Manager → HR → Payroll → Finance', icon: Layers },
  { num: '03', title: 'Compliance Check', desc: 'GST validation & exception handling', icon: ShieldCheck },
  { num: '04', title: 'Payment', desc: 'Direct to finance queue with audit trail', icon: CreditCard },
];

function AnimatedWorkflow() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    // Give the multi-stage review step more time to finish its sequence
    const delay = activeStep === 1 ? 5000 : 4000;
    const timer = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % WORKFLOW_STEPS.length);
    }, delay);
    return () => clearTimeout(timer);
  }, [activeStep]);

  const renderMockWindow = () => {
    switch (activeStep) {
      case 0:
        return (
          <div key="step0" className="flex flex-col items-center justify-center h-full space-y-4 animate-fade-in">
            <div className="relative">
              <div className="h-24 w-16 bg-white border-2 border-slate-200 rounded-sm shadow-sm relative z-10" />
              <div className="absolute left-0 right-0 h-[2px] bg-emerald-400 animate-scan shadow-[0_0_8px_rgba(52,211,153,0.8)] z-20" />
            </div>
            <p className="text-[13px] font-semibold text-slate-600">Auto-scanning receipt...</p>
          </div>
        );
      case 1:
        return (
          <div key="step1" className="flex flex-col items-center justify-center h-full space-y-6 animate-fade-in w-full px-4">
            <div className="flex items-center w-full justify-between gap-1">
              {/* Manager */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center relative shadow-sm">
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full border border-white flex items-center justify-center opacity-0 animate-[pop-in_0.4s_forwards]" style={{ animationDelay: '0.2s' }}><CheckCircle2 className="h-2 w-2 text-white" /></span>
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Mgr</span>
              </div>
              <div className="h-0.5 flex-1 bg-slate-100 rounded-full mx-1 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-400 origin-left scale-x-0 animate-[scale-line_0.6s_forwards]" style={{ animationDelay: '0.6s' }} />
              </div>

              {/* HR */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center relative shadow-sm">
                  <Users className="h-3.5 w-3.5 text-slate-500" />
                  <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full border border-white flex items-center justify-center opacity-0 animate-[pop-in_0.4s_forwards]" style={{ animationDelay: '1.2s' }}><CheckCircle2 className="h-2 w-2 text-white" /></span>
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">HR</span>
              </div>
              <div className="h-0.5 flex-1 bg-slate-100 rounded-full mx-1 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-400 origin-left scale-x-0 animate-[scale-line_0.6s_forwards]" style={{ animationDelay: '1.6s' }} />
              </div>

              {/* Payroll */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center relative shadow-sm">
                  <CreditCard className="h-3.5 w-3.5 text-slate-500" />
                  <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full border border-white flex items-center justify-center opacity-0 animate-[pop-in_0.4s_forwards]" style={{ animationDelay: '2.2s' }}><CheckCircle2 className="h-2 w-2 text-white" /></span>
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pay</span>
              </div>
              <div className="h-0.5 flex-1 bg-slate-100 rounded-full mx-1 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-400 origin-left scale-x-0 animate-[scale-line_0.6s_forwards]" style={{ animationDelay: '2.6s' }} />
              </div>

              {/* Finance */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center relative shadow-sm">
                  <Coins className="h-3.5 w-3.5 text-slate-500" />
                  <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-emerald-500 rounded-full border border-white flex items-center justify-center opacity-0 animate-[pop-in_0.4s_forwards]" style={{ animationDelay: '3.2s' }}><CheckCircle2 className="h-2 w-2 text-white" /></span>
                </div>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Fin</span>
              </div>
            </div>
            <p className="text-[13px] font-semibold text-slate-600 opacity-0 animate-[pop-in_0.4s_forwards]" style={{ animationDelay: '3.6s' }}>4-Stage Approval Complete</p>
          </div>
        );
      case 2:
        return (
          <div key="step2" className="flex flex-col items-center justify-center h-full space-y-5 animate-fade-in">
            <div className="relative animate-breathe">
              <ShieldCheck className="h-14 w-14 text-emerald-500 relative z-10" />
              <div className="absolute inset-2 bg-emerald-400 blur-lg opacity-40 animate-pulse rounded-full" />
            </div>
            <div className="space-y-2 text-center w-full max-w-[120px]">
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-emerald-100 via-emerald-400 to-emerald-100 animate-flow" />
              </div>
              <div className="h-2 w-3/4 bg-emerald-200 rounded-full mx-auto animate-pulse" />
            </div>
            <p className="text-[12px] font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">Policy limits OK</p>
          </div>
        );
      case 3:
        return (
          <div key="step3" className="flex flex-col items-center justify-center h-full space-y-6 animate-fade-in">
            <div className="h-14 w-14 bg-brand rounded-full flex items-center justify-center animate-ripple relative">
              <ArrowRight className="h-6 w-6 text-white -rotate-45 relative z-10" />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-bold text-slate-800">₹ 24,500.00 Sent</p>
              <p className="text-[11px] text-slate-400 mt-1">Direct to bank account</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="mt-14 grid lg:grid-cols-[1fr_1fr] gap-10 lg:gap-16 items-center">
      {/* Left Stepper */}
      <div className="space-y-3">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isActive = idx === activeStep;
          const StepIcon = step.icon;
          return (
            <div
              key={step.num}
              onClick={() => setActiveStep(idx)}
              className={`flex gap-4 p-4 rounded-2xl cursor-pointer transition-all duration-300 border hover:-translate-y-1 ${isActive ? 'bg-white shadow-xl shadow-emerald-500/10 border-emerald-100 scale-[1.02]' : 'bg-transparent border-transparent hover:bg-white/60 hover:shadow-md'}`}
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${isActive ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-100 text-slate-400'}`}>
                <StepIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className={`text-[14px] font-bold transition-colors duration-300 ${isActive ? 'text-emerald-900' : 'text-slate-600'}`}>{step.title}</h3>
                <p className={`mt-0.5 text-[12px] leading-relaxed transition-colors duration-300 ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right Mock Window */}
      <div className="relative rounded-3xl bg-slate-100 p-2 shadow-inner border border-slate-200/60 aspect-square md:aspect-[4/3] flex flex-col overflow-hidden">
        {/* Mac window dots */}
        <div className="flex gap-1.5 px-4 py-3">
          <div className="h-2 w-2 rounded-full bg-slate-300" />
          <div className="h-2 w-2 rounded-full bg-slate-300" />
          <div className="h-2 w-2 rounded-full bg-slate-300" />
        </div>
        <div key={activeStep} className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
          {renderMockWindow()}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const flag = searchParams.get('login');
    if (flag === '1' || flag === 'true') {
      navigate('/login', { replace: true });
    }
  }, [searchParams, navigate]);

  return (
    <div className="flex min-h-screen flex-col text-ink antialiased bg-slate-50">
      {/* ── HEADER ── */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <img src="/companylogo.png" alt="Company Logo" className="h-12 w-auto object-contain rounded" />
          </div>
          <button
            type="button"
            className="group flex items-center gap-1.5 rounded-lg bg-emerald-50 text-brand px-5 h-9 text-[13px] font-bold shadow-sm ring-1 ring-emerald-500/20 transition-all hover:bg-emerald-100 hover:shadow-md active:scale-95"
            onClick={() => navigate('/login')}
          >
            Sign in
            <span className="transition-transform duration-200 group-hover:translate-x-1">
              <LogIn className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* ── HERO & STATS WRAPPER ── */}
        <div className="relative overflow-hidden">
          {/* Background Image & Overlay */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'url(/hero_travel_image.png)',
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
            aria-hidden
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-50/95 via-slate-50/60 to-transparent" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-50" aria-hidden />

          {/* ── HERO ── */}
          <section className="relative z-10">
            <div className="mx-auto max-w-6xl px-5 pb-16 pt-6 md:px-8 md:pb-24 md:pt-10">
              <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
                {/* Left column */}
                <div className="space-y-7">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-brand/15 bg-brand/5 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand">
                    <Zap className="h-3 w-3" />
                    Enterprise-grade reimbursement
                  </div>

                  <h1 className="text-[2.25rem] font-extrabold leading-[1.15] tracking-tight text-ink md:text-[2.75rem] lg:text-[3.25rem]">
                    Claims, travel, and payouts — <span className="bg-gradient-to-r from-brand to-emerald-600 bg-clip-text text-transparent">without the chaos</span>.
                  </h1>

                  <p className="max-w-lg text-[15px] leading-[1.7] text-slate-500">
                    One secure portal for your entire organization. Policy validation, multi-stage approvals, and full audit trails — from draft to payment.
                  </p>

                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <button
                      type="button"
                      className="group flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-emerald-500 px-8 text-[15px] font-bold text-white shadow-lg shadow-emerald-500/25 ring-1 ring-white/20 ring-inset transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/40 active:scale-[0.98]"
                      onClick={() => {
                        const el = document.getElementById('how-it-works');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      See how it works
                      <span className="transition-transform duration-300 group-hover:-translate-y-0.5">
                        <ChevronDown className="h-4 w-4" />
                      </span>
                    </button>
                    <span className="text-[14px] font-medium text-slate-700">Explore the approval workflow.</span>
                  </div>
                </div>

                {/* Right column — At a Glance card */}
                <div className="relative">
                  <div className="absolute -right-6 -top-6 -z-10 h-40 w-40 rounded-full bg-brand/5 blur-3xl" aria-hidden />
                  <div className="rounded-3xl bg-white p-7 shadow-xl shadow-slate-200/50 md:p-8">
                    <div className="flex items-center gap-2 mb-6">
                      <div className="h-1 w-5 rounded-full bg-brand" />
                      <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">At a glance</h2>
                    </div>
                    <ul className="space-y-5">
                      {[
                        { icon: FileCheck, color: 'bg-emerald-50 text-emerald-600', title: 'Policy-aware drafts', desc: 'Auto-validates city caps, limits, and compliance before submission.' },
                        { icon: Layers, color: 'bg-sky-50 text-sky-600', title: 'Role-based workspaces', desc: 'Tailored dashboards for employees, managers, HR, and finance.' },
                        { icon: ShieldCheck, color: 'bg-amber-50 text-amber-600', title: 'Audit & reporting', desc: 'Full exception logs, digital invoicing, and complete audit trail.' },
                      ].map((item) => (
                        <li key={item.title} className="flex gap-3.5 group">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.color} transition-transform duration-200 group-hover:scale-105`}>
                            <item.icon className="h-[18px] w-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-ink">{item.title}</p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-400">{item.desc}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── STATS RIBBON ── */}
          <section className="relative z-10 -mt-10 mx-auto max-w-5xl px-5 md:px-8 pb-10">
            <div className="rounded-3xl bg-white shadow-xl shadow-slate-200/50 p-2 relative overflow-hidden">
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-100 relative z-10">
                {STATS.map((s) => (
                  <div key={s.label} className="group px-6 py-8 text-center transition-colors hover:bg-slate-50/80 rounded-xl">
                    <p className="text-2xl font-black tracking-tight text-brand md:text-3xl transition-transform group-hover:scale-105">{s.value}</p>
                    <p className="mt-2 text-[12px] font-bold uppercase tracking-widest text-slate-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* ── WORKFLOW STEPS ── */}
        <section id="how-it-works" className="py-16 md:py-20 relative z-0">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink md:text-[1.85rem]">How it works</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
                From expense submission to final payment — every step is tracked, compliant, and transparent.
              </p>
            </div>

            <AnimatedWorkflow />
          </div>
        </section>

        {/* ── AUDIENCE SECTION ── */}
        <section className="py-16 md:py-20 relative z-0">
          <div className="absolute top-1/2 left-0 -translate-y-1/2 -z-10 h-96 w-96 rounded-full bg-teal-500/5 blur-3xl" aria-hidden />
          <div className="absolute bottom-0 right-0 -z-10 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" aria-hidden />
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink md:text-[1.85rem]">Built for your whole organization</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-slate-500">
                Same platform, different lenses — so every team collaborates without duplicating data.
              </p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {AUDIENCES.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.label}
                    className="group relative rounded-3xl bg-white p-6 shadow-xl shadow-slate-200/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-slate-200/50"
                  >
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${item.gradient} text-white shadow-sm mb-5 transition-transform duration-300 group-hover:scale-110`}>
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <h3 className="text-[15px] font-bold text-ink">{item.label}</h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{item.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── WHY TEAMS CHOOSE TRP ── */}
        <section className="py-16 md:py-20 relative z-0">
          <div className="absolute top-0 right-1/4 -z-10 h-96 w-96 rounded-full bg-green-500/5 blur-3xl" aria-hidden />
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink md:text-[1.85rem]">Why teams choose Travora</h2>
              <p className="mt-3 text-[14px] text-slate-500 leading-relaxed">Fewer bottlenecks, clearer accountability, and faster reimbursement cycles.</p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const IconComponent = f.icon;
                return (
                  <div
                    key={f.title}
                    className="group rounded-3xl bg-white p-7 shadow-xl shadow-slate-200/40 transition-all duration-300 hover:shadow-2xl hover:shadow-slate-200/50 hover:-translate-y-0.5"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`h-2 w-2 rounded-full ${f.accent}`} />
                      <h3 className="text-[15px] font-bold text-ink">{f.title}</h3>
                    </div>
                    <p className="text-[13px] leading-[1.7] text-slate-400">{f.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── CTA BANNER ── */}
        <section className="relative overflow-hidden" style={{
          background: 'linear-gradient(135deg, #0a3d2e 0%, #116149 50%, #0e4f3c 100%)',
        }}>
          {/* Decorative elements */}
          <div className="absolute top-0 left-0 h-full w-full opacity-[0.04]" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }} aria-hidden />
          <div className="absolute top-1/2 left-1/4 -translate-y-1/2 h-64 w-64 rounded-full bg-emerald-400/8 blur-[80px]" aria-hidden />
          <div className="absolute top-1/2 right-1/4 -translate-y-1/2 h-48 w-48 rounded-full bg-white/5 blur-[60px]" aria-hidden />

          <div className="relative mx-auto max-w-4xl px-5 py-16 text-center md:py-20 md:px-8">
            <h2 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl lg:text-4xl">
              Ready to open the portal?
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-emerald-200/70">
              Log in with your corporate credentials to manage claims, review exceptions, and track active workflows.
            </p>
            <div className="mt-8">
              <button
                type="button"
                className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-white px-8 text-[15px] font-bold text-brand shadow-lg shadow-black/10 transition-all duration-200 hover:shadow-xl hover:shadow-black/15 active:scale-[0.98]"
                onClick={() => navigate('/login')}
              >
                Sign in to Dashboard
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-slate-200/70 bg-white py-6">
        <div className="mx-auto max-w-6xl px-5 flex flex-col md:flex-row items-center justify-between gap-3 md:px-8">
          <p className="text-[11px] font-medium text-slate-400">&copy; {new Date().getFullYear()} Travora · Internal use only</p>

        </div>
      </footer>

    </div>
  );
}
