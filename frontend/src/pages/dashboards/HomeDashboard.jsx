import { Bus, CalendarDays, ClipboardList, Pencil, Plane, Plus, ReceiptIndianRupee, Ticket, Train, Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ClaimListRow, describeClaim } from '../../components/claims/ClaimListRow';
import MyLimitsModal from '../../components/dashboard/MyLimitsModal';
import {
  AttentionPanel,
  DateBox,
  EmptyState,
  HomeHeader,
  MoneyStrip,
  Panel,
  PanelNote,
  SectionTitle,
  dayOf,
  inr,
  plural,
  shortDate,
  today,
} from '../../components/home/HomeParts';
import { AdminSection, CompanyReports, FinanceSection, TeamSection } from '../../components/home/RoleSections';
import { useApprovalQueues } from '../../components/home/useApprovalQueues';
import { requestRoute, useOwnHome } from '../../components/home/useOwnHome';
import { useSetPageTitle } from '../../context/PageTitleContext';
import { hasPermission } from '../../services/permissions';
import { selectResolvedRole, useAuthStore } from '../../store/authStore';
import { claimEditPath, claimNewPath } from '../../utils/claimRoutes';

/*
 * Home for every role. Top to bottom: what needs you (approval queues + your own to-dos), your
 * own money / claims / trips (the same for everyone), then the parts your permissions add —
 * team travel and spend, finance figures, the system snapshot, company report charts.
 */

const MODE_ICON = { FLIGHT: Plane, TRAIN: Train, BUS: Bus };
const MODE_NAME = { FLIGHT: 'Flight', TRAIN: 'Train', BUS: 'Bus' };
const PILL = {
  ok: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  sky: 'bg-sky-50 text-sky-700',
  slate: 'bg-slate-100 text-slate-500',
};

function rowButton(label, onClick, danger = false) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex h-7 items-center whitespace-nowrap rounded-lg px-2.5 text-[11.5px] font-bold text-white ${
        danger ? 'bg-rose-700 hover:bg-rose-800' : 'bg-brand hover:bg-brand/90'
      }`}
    >
      {label}
    </button>
  );
}

function TripRow({ trip, onOpen }) {
  const { request, start, end, status } = trip;
  const now = today();
  const onNow = start <= now && end >= now;
  const legs = request.trip_type === 'MULTI_CITY' ? (request.legs || []).length : 0;
  const Icon = MODE_ICON[request.travel_mode] || Plane;
  const parts = [
    MODE_NAME[request.travel_mode] || request.travel_mode,
    legs ? `${legs} legs · ${shortDate(start)}–${shortDate(end)}` : null,
    request.trip_type === 'ROUND_TRIP' && end > start ? `back ${shortDate(end)}` : null,
    start.getTime() === now.getTime() ? 'Today' : null,
    request.purpose,
  ].filter(Boolean);
  const route = requestRoute(request);
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-slate-100 px-4 py-[11px] first:border-t-0 hover:bg-[#fbfdfc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      <DateBox date={start} now={onNow} />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-extrabold text-ink" title={route.join(' → ')}>
          {route.map((city, i) => (
            <span key={`${city}-${i}`}>
              {i ? <span className="mx-0.5 font-semibold text-slate-400"> → </span> : null}
              {city}
            </span>
          ))}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
          <Icon size={13} className="flex-none" />
          <span className="truncate">{parts.join(' · ')}</span>
          {onNow && end > start ? <span className="whitespace-nowrap rounded-md bg-brand/10 px-1.5 text-[10.5px] font-bold text-brand">On now</span> : null}
        </div>
      </div>
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${PILL[status.tone]}`}>{status.pill}</span>
    </div>
  );
}

export default function HomeDashboard() {
  useSetPageTitle('Home');
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore(selectResolvedRole);
  const permissions = profile?.permissions;
  const can = (p) => hasPermission(permissions, p);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const closeLimits = useCallback(() => setLimitsOpen(false), []);

  const own = useOwnHome(profile);
  const queues = useApprovalQueues(profile, role);

  const displayName = profile?.full_name ?? user?.full_name ?? user?.email ?? 'there';
  const firstName = displayName.split(' ')[0];

  /* ---- Needs your attention ---- */
  const approvals = queues.items.map((q) => ({
    ...q,
    action: { label: q.label, onClick: () => navigate(q.to) },
  }));
  const mine = [];
  if (!own.loading) {
    own.sentBack.forEach(({ claim, note }) =>
      mine.push({
        key: `sb-${claim.id}`,
        icon: Undo2,
        iconTone: 'rose',
        title: `${claim.claim_reference || `Claim #${claim.id}`} was sent back to you`,
        sub: note?.comment ? `“${note.comment}”${note.actor ? ` · ${note.actor}` : ''}` : describeClaim(claim),
        when: 'Waiting on you',
        whenTone: 'rose',
        action: { label: 'Fix & resubmit', danger: true, onClick: () => navigate(claimEditPath(claim)) },
      }),
    );
    own.drafts.forEach((claim) =>
      mine.push({
        key: `d-${claim.id}`,
        icon: Pencil,
        iconTone: 'slate',
        title: 'Finish your draft',
        sub: `${describeClaim(claim)} · started ${shortDate(dayOf(claim.created_at))}`,
        when: 'Draft',
        whenTone: 'slate',
        action: { label: 'Continue', onClick: () => navigate(claimEditPath(claim)) },
      }),
    );
    own.toClaim.forEach((t) =>
      mine.push({
        key: `t-${t.key}`,
        icon: Ticket,
        iconTone: t.closed ? 'slate' : 'sky',
        title: `Claim your trip: ${t.route}`,
        sub: t.sub,
        when: t.when,
        whenTone: t.late ? 'rose' : 'amber',
        closed: t.closed,
        action: t.closed ? null : { label: 'Start claim', onClick: () => navigate(claimNewPath('TRAVEL', { tripIds: t.ids.join(',') })) },
      }),
    );
  }

  /* ---- One-line summary under the greeting ---- */
  const waitingTotal = queues.items.reduce((a, q) => a + q.count, 0);
  const nextClaim = own.loading ? null : own.toClaim.find((t) => !t.late);
  const bits = [];
  if (waitingTotal) bits.push(<b key="w">{plural(waitingTotal, 'thing')} waiting on you</b>);
  if (!own.loading) {
    if (own.sentBack.length) bits.push(<b key="sb">{plural(own.sentBack.length, 'claim')} sent back</b>);
    if (own.drafts.length) bits.push(<span key="d">{plural(own.drafts.length, 'draft')}</span>);
    if (nextClaim) {
      const n = own.toClaim.filter((t) => !t.late).length;
      bits.push(
        <b key="tc">
          {plural(n, 'trip')} to claim{nextClaim.soon ? ` by ${nextClaim.when.includes('today') ? 'today' : 'tomorrow'}` : ''}
        </b>,
      );
    }
    if (own.inReview.length) bits.push(<span key="r">{plural(own.inReview.length, 'claim')} in review</span>);
    if (own.upcomingCount) bits.push(<span key="u">{plural(own.upcomingCount, 'trip')} coming up</span>);
  }
  const summary =
    own.loading || queues.loading ? (
      'Getting your day ready…'
    ) : bits.length ? (
      <>
        {bits.map((b, i) => (
          <span key={b.key}>
            {i ? ' · ' : ''}
            {b}
          </span>
        ))}
        .
      </>
    ) : own.claims.length ? (
      'Nothing needs you right now.'
    ) : (
      'Welcome to Travora. Nothing needs you right now.'
    );

  /* ---- Own money ---- */
  const m = own.money;
  const moneyCells = own.loading
    ? null
    : [
        {
          label: 'Waiting for approval',
          value: inr(m.waiting),
          zero: !m.waitingCount,
          sub: m.waitingCount ? (
            <>
              {plural(m.waitingCount, 'claim')}
              {m.waitingOnlyException ? ' · in exception review' : ''}
              {m.toPayCount ? ` · ${inr(m.toPay)} approved, awaiting payment` : ''}
            </>
          ) : m.toPayCount ? (
            `${inr(m.toPay)} approved, awaiting payment`
          ) : (
            'Nothing waiting'
          ),
        },
        {
          label: `Paid to you · ${m.fyLabel}`,
          value: inr(m.paid),
          zero: !m.paidCount,
          sub: m.paidCount ? (
            <>
              {plural(m.paidCount, 'claim')}
              {m.lastPaid ? ` · last paid ${shortDate(m.lastPaid)}` : ''} · <Link to="/claims/my?tab=paid">See paid</Link>
            </>
          ) : (
            'No payments yet this year'
          ),
        },
        {
          label: 'Invoices not on a claim',
          value: String(m.invoices),
          zero: !m.invoices,
          sub: m.invoices ? (
            <>
              {inr(m.invoiceTotal)} in total · <Link to="/invoices">Add to a claim</Link>
            </>
          ) : (
            <>
              Got a bill? <Link to="/invoices">Upload an invoice</Link>
            </>
          ),
        },
      ];

  const showTeam = can('view_team_calendar') || can('view_team_claims');
  const showFinance = can('process_advances');
  const showAdmin = can('manage_users');
  const showReports = can('view_reports');
  const hasRolePart = showTeam || showFinance || showAdmin || showReports;

  return (
    <div className="flex flex-col gap-4">
      <HomeHeader firstName={firstName} summary={summary} profile={profile} onOpenLimits={() => setLimitsOpen(true)} />
      <MyLimitsModal open={limitsOpen} onClose={closeLimits} />

      <AttentionPanel
        approvals={approvals}
        mine={mine}
        coming={queues.coming ? <><b>Coming your way:</b> {queues.coming}</> : null}
        loading={own.loading || queues.loading}
        emptyTitle={own.claims?.length || approvals.length ? "You're all caught up" : "You're all set"}
        emptyText={
          own.claims?.length
            ? 'Nothing is waiting on you. Sent-back claims, drafts and trips to claim will show up here.'
            : 'Things you need to do, like a claim sent back to you or a trip to claim, will show up here.'
        }
      />

      {hasRolePart ? <SectionTitle title="Your own claims and travel" /> : null}
      {moneyCells ? <MoneyStrip cells={moneyCells} /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel title="Recent claims" link={{ to: '/claims/my', label: 'All claims' }}>
          {own.loading ? <PanelNote>Loading your claims…</PanelNote> : null}
          {!own.loading && !own.recent.length ? (
            <EmptyState
              icon={ReceiptIndianRupee}
              title="No claims yet"
              actions={
                <>
                  <Link to={claimNewPath('TRAVEL')} className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90">
                    <Plane size={14} /> Travel claim
                  </Link>
                  <Link
                    to={claimNewPath('GENERAL')}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <ClipboardList size={14} /> General reimbursement
                  </Link>
                </>
              }
            >
              Spent your own money on a work trip or a work expense? Claim it back here and follow it until it&apos;s paid.
            </EmptyState>
          ) : null}
          {!own.loading
            ? own.recent.map(({ claim, standing }) => (
                <ClaimListRow
                  key={claim.id}
                  compact
                  claim={claim}
                  standing={standing}
                  onOpen={() => navigate(claim.status === 'DRAFT' ? claimEditPath(claim) : `/claims/${claim.id}`)}
                  actions={
                    claim.status === 'SENT_BACK'
                      ? rowButton('Fix & resubmit', () => navigate(claimEditPath(claim)), true)
                      : claim.status === 'DRAFT'
                        ? rowButton('Continue', () => navigate(claimEditPath(claim)))
                        : null
                  }
                />
              ))
            : null}
        </Panel>

        <Panel title="Upcoming trips" link={{ to: '/travel-requests', label: 'All travel requests' }}>
          {own.loading ? <PanelNote>Loading your trips…</PanelNote> : null}
          {!own.loading && !own.upcoming.length ? (
            <EmptyState
              icon={CalendarDays}
              tone="sky"
              title="No trips coming up"
              actions={
                <Link to="/travel-requests" className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[11.5px] font-bold text-white hover:bg-brand/90">
                  <Plus size={14} /> Request travel
                </Link>
              }
            >
              {own.claims.length
                ? 'Your past trips are under All travel requests. Raise a new request when you next need to travel.'
                : 'Need to travel for work? Raise a travel request. Once it is approved, the travel desk books your tickets.'}
            </EmptyState>
          ) : null}
          {!own.loading ? own.upcoming.map((t) => <TripRow key={t.request.id} trip={t} onOpen={() => navigate('/travel-requests')} />) : null}
          {!own.loading && own.moreUpcoming ? (
            <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              + {own.moreUpcoming} more upcoming ·{' '}
              <Link to="/travel-requests" className="font-bold text-brand hover:underline">
                See all
              </Link>
            </div>
          ) : null}
        </Panel>
      </div>

      {showTeam ? <TeamSection showCalendar={can('view_team_calendar')} showSpend={can('view_team_claims')} /> : null}
      {showFinance ? <FinanceSection paymentRows={queues.paymentRows} /> : null}
      {showAdmin ? <AdminSection canSeeAudit={can('export_audit')} /> : null}
      {showReports ? <CompanyReports /> : null}
    </div>
  );
}
