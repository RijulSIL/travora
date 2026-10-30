import { AlertTriangle, Building2, Plane, ReceiptIndianRupee, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { relocationRef } from '../claims/ClaimRelocationSteps';
import { hasPermission } from '../../services/permissions';
import { reimbursementApi } from '../../services/reimbursementApi';
import { dayOf, daysBetween, inr, plural, shortDate, slaText, today } from './HomeParts';
import { requestSpan, travelRef } from './useOwnHome';

/*
 * The approval queues waiting on the viewer, one summary line each, for Home's "Needs your
 * attention". What's loaded follows the viewer's approval scope and permissions (not their role
 * name), so delegation and Role Permissions changes carry through. Each line's button opens the
 * full queue. Read-only.
 */

/** "Rijul Narang (6), test3 (1)" — who a queue's items are from. */
function whoFrom(names) {
  const counts = new Map();
  names.filter(Boolean).forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (list.length === 1) return `${list[0][1] > 1 ? 'all from ' : ''}${list[0][0]}`;
  const shown = list.slice(0, 3).map(([n, c]) => `${n} (${c})`).join(', ');
  return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
}

/** Earliest SLA deadline among items, as the queue's "when" text. */
function earliestSla(deadlines) {
  const first = deadlines.filter(Boolean).sort()[0];
  return first ? slaText(first) : null;
}

/** Does the viewer's role sit on this exception decision? (HRBP is an alias of HRBP_HR.) */
function isMyRole(requiredRole, role) {
  return requiredRole === role || (requiredRole === 'HRBP_HR' && (role === 'HRBP' || role === 'HRBP_HR'));
}

export function useApprovalQueues(profile, role) {
  const [state, setState] = useState({ loading: true, items: [], coming: null, paymentRows: [] });
  const scope = profile?.approver_scope || {};
  const permissions = profile?.permissions;
  const wantClaims = Boolean(scope.claims) || hasPermission(permissions, 'process_payments');
  const wantTravel = Boolean(scope.travel_request);
  const wantRelocation = Boolean(scope.relocation);
  const wantExceptions = Boolean(scope.exceptions?.length);
  const wantDesk = hasPermission(permissions, 'view_travel_desk');
  const ready = Boolean(profile);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const get = (want, call) => (want ? call().then((r) => r.data || []).catch(() => []) : Promise.resolve([]));
    (async () => {
      const [claims, travel, relocation, mineNow, allExc, desk] = await Promise.all([
        get(wantClaims, reimbursementApi.pendingApprovals),
        get(wantTravel, reimbursementApi.travelRequestsManagerPending),
        get(wantRelocation, reimbursementApi.relocationPending),
        // With status=PENDING the backend returns only exceptions the viewer can act on right
        // now (its own check — it also knows *which* manager); the full log is for "coming".
        get(wantExceptions, () => reimbursementApi.exceptionRequestsLog({ status: 'PENDING' })),
        get(wantExceptions, () => reimbursementApi.exceptionRequestsLog()),
        get(wantDesk, reimbursementApi.travelDeskQueue),
      ]);
      if (cancelled) return;
      const now = today();
      const items = [];

      // Policy exceptions waiting on the viewer.
      const myStep = (e) =>
        (e.decisions || []).find((d) => d.status === 'PENDING' && isMyRole(d.required_role, role)) ||
        (e.decisions || []).find((d) => d.status === 'PENDING');
      if (mineNow.length) {
        const onClaims = mineNow.filter((e) => e.claim_id).length;
        const sla = earliestSla(mineNow.map((e) => myStep(e)?.sla_deadline_at));
        items.push({
          key: 'exceptions',
          count: mineNow.length,
          icon: AlertTriangle,
          iconTone: 'amber',
          title: `${plural(mineNow.length, 'policy exception')} to decide`,
          sub: `${mineNow.slice(0, 4).map((e) => e.exception_ref).join(', ')}${mineNow.length > 4 ? ` +${mineNow.length - 4} more` : ''} · ${whoFrom(
            mineNow.map((e) => e.employee),
          )}${mineNow.length > 1 ? ` · ${onClaims ? `${plural(onClaims, 'claim')}, ` : ''}${plural(mineNow.length - onClaims, 'trip')}` : ''}`,
          when: sla?.text || '',
          whenTone: sla?.tone,
          to: '/hr/exceptions',
          label: 'Review',
        });
      }

      if (claims.length) {
        const sla = earliestSla(claims.map((c) => c.sla_deadline_at));
        const total = claims.reduce((a, c) => a + Number(c.amount || 0), 0);
        items.push({
          key: 'claims',
          count: claims.length,
          icon: ReceiptIndianRupee,
          iconTone: 'sky',
          title: `${plural(claims.length, 'claim')} to review`,
          sub: `${whoFrom(claims.map((c) => c.employee_name))} · ${inr(total)} in total`,
          when: sla?.text || '',
          whenTone: sla?.tone,
          to: '/claims/pending?tab=claims',
          label: 'Review',
        });
      }

      if (travel.length) {
        const reqs = travel.map((row) => ({ ...row, request: row.request || row }));
        const past = reqs.filter((r) => {
          const { start } = requestSpan(r.request);
          return start && start < now;
        }).length;
        const oldest = reqs.map((r) => dayOf(r.request.requested_at)).filter(Boolean).sort((a, b) => a - b)[0];
        const waited = oldest ? daysBetween(oldest, now) : 0;
        items.push({
          key: 'travel',
          count: reqs.length,
          icon: Plane,
          iconTone: 'sky',
          title: `${plural(reqs.length, 'travel request')} to approve`,
          sub: (
            <>
              {whoFrom(reqs.map((r) => r.employee_display_name))}
              {past ? (
                <>
                  {' · '}
                  <b>{past === 1 ? '1 is for a trip that already happened' : `${past} are for trips that already happened`}</b>
                </>
              ) : null}
            </>
          ),
          subTitle: whoFrom(reqs.map((r) => r.employee_display_name)),
          when: waited >= 1 ? `Oldest waiting ${plural(waited, 'day')}` : 'Came in today',
          whenTone: waited >= 3 ? 'amber' : 'slate',
          to: '/claims/pending?tab=travel',
          label: 'Review',
        });
      }

      if (relocation.length) {
        const current = (r) => (r.stages || []).find((s) => s.status === 'PENDING');
        const sla = earliestSla(relocation.map((r) => current(r)?.sla_deadline_at));
        const one = relocation.length === 1 ? relocation[0] : null;
        items.push({
          key: 'relocation',
          count: relocation.length,
          icon: Truck,
          iconTone: 'fuchsia',
          title: `${plural(relocation.length, 'relocation request')} to review`,
          sub: one
            ? [
                relocationRef(one),
                one.employee_name,
                `${one.origin_city} → ${one.destination_city}`,
                one.details?.travel_date ? `travelling ${shortDate(dayOf(one.details.travel_date))}` : null,
                one.estimated_amount ? `est. ${inr(one.estimated_amount)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : whoFrom(relocation.map((r) => r.employee_name)),
          when: sla?.text || '',
          whenTone: sla?.tone,
          to: '/claims/pending?tab=relocation',
          label: 'Review',
        });
      }

      if (desk.length) {
        const reqs = desk.map((row) => ({ ...row, request: row.request || row }));
        const past = reqs.filter((r) => {
          const { start } = requestSpan(r.request);
          return start && start < now;
        }).length;
        const nextTrip = reqs.map((r) => requestSpan(r.request).start).filter((d) => d && d >= now).sort((a, b) => a - b)[0];
        items.push({
          key: 'desk',
          count: reqs.length,
          icon: Building2,
          iconTone: 'sky',
          title: `${plural(reqs.length, 'approved trip')} to book (travel desk)`,
          sub: reqs
            .slice(0, 3)
            .map((r) => `${travelRef(r.request.id)} ${[r.request.from_city, r.request.to_city].filter(Boolean).join(' → ') || 'multi-city'}`)
            .join(', '),
          when: past
            ? past === reqs.length
              ? `${past === 1 ? 'Its travel date has' : `All ${past} travel dates have`} passed`
              : `${plural(past, 'travel date')} already passed`
            : nextTrip
              ? `Next trip ${shortDate(nextTrip)}`
              : '',
          whenTone: past ? 'rose' : 'amber',
          to: '/travel-desk',
          label: 'Open travel desk',
        });
      }

      // What reaches the viewer after earlier approvers decide.
      const mineIds = new Set(mineNow.map((e) => e.exception_id));
      const comingExc = allExc.filter(
        (e) =>
          e.status === 'PENDING' &&
          !mineIds.has(e.exception_id) &&
          (e.decisions || []).some((d) => d.status === 'AWAITING' && isMyRole(d.required_role, role)),
      );
      const coming = comingExc.length
        ? `${plural(comingExc.length, 'exception')} (${comingExc
            .slice(0, 4)
            .map((e) => e.exception_ref)
            .join(', ')}${comingExc.length > 4 ? '…' : ''}) reach${comingExc.length === 1 ? 'es' : ''} you after earlier approvers.`
        : null;

      setState({ loading: false, items, coming, paymentRows: claims });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, role, wantClaims, wantTravel, wantRelocation, wantExceptions, wantDesk]);

  return state;
}
