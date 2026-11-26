/**
 * The welcome tours (WelcomeTour.jsx): one short guided tour per role. Each opens with what
 * happens to a trip or a claim from that person's side (`journey`), then points at where each
 * part is done. Keys must match backend onboarding_tour_service.TOUR_KEYS, which also decides
 * who gets which tour (`pending_tours` / `available_tours` on /me).
 *
 * A stop's `targets` are data-tour marks, tried in order: `nav:<path>` (a sidebar link, query
 * string dropped — navConfig.tourKeyFor), `group:<title>` (a titled sidebar section), `new-claim`
 * (the New claim button), and on Home `limits`, `attention` and `bell`. A stop with none of its
 * marks in the person's sidebar is left out (buildStops).
 */

const days = (n) => (n === 1 ? '1 day' : `${n} days`);

const OWN = {
  targets: ['group:My Claims & Travel', 'nav:/claims/my'],
  title: 'Your own trips and claims',
  body: () =>
    'These work the same as for everyone. Ask for trips, upload bills and claim from here and the New claim button. Your own requests go to your own approvers.',
};

const ATTENTION = (body) => ({ targets: ['attention'], title: "What's waiting on you", body: () => body });

export const TOURS = {
  employee: {
    title: 'Employee tour',
    hello: "here's how Travora works",
    intro: 'Travora is where you ask for work trips and get back what you spend for work. Every trip follows the same path:',
    journey: ['Ask for a trip', 'Approved and booked', 'Upload your bills', 'Claim', 'Paid'],
    firsts: ["Open your limits so you know what's covered", 'Ask for your next work trip', 'Upload any bills you already have'],
    stops: [
      {
        targets: ['nav:/travel-requests'],
        title: 'Ask for a trip',
        body: () =>
          "Every work trip starts here. Add where and when, say who's booking, and send it. Once your approvers say yes, the trip is booked and the tickets show up on the request.",
      },
      {
        targets: ['nav:/invoices'],
        title: 'Upload bills as you go',
        body: () => 'During the trip, upload or photograph each bill. Travora reads the amount, date and GST for you.',
      },
      {
        targets: ['new-claim'],
        title: 'Claim your money back',
        body: ({ lateDays }) =>
          `After the trip, use New claim to start a Travel claim and add your bills. Do it within ${days(lateDays)} of getting back. Other work costs go on a General reimbursement.`,
      },
      {
        targets: ['nav:/claims/my'],
        title: "Follow it until it's paid",
        body: () =>
          "Your claim goes to your manager first, then on to HR and Finance. See who has it now. If it's sent back, fix it and send it again.",
      },
      {
        targets: ['limits'],
        title: 'Your limits',
        body: () =>
          'What the company pays for hotels, food and local travel at your level. Going over a limit needs an extra approval, so check here first.',
      },
      {
        targets: ['attention'],
        title: 'What needs you',
        body: () => 'Anything waiting on you shows up here, like a claim sent back or a trip you can now claim for.',
      },
      {
        targets: ['bell'],
        title: 'Updates',
        body: () => 'Approvals, send-backs and payments show up here, and by email too.',
      },
    ],
  },

  manager: {
    title: 'Manager tour',
    hello: "here's your part in Travora",
    intro: 'The people who report to you ask for trips and claim their costs in Travora. Each request comes to you first:',
    journey: ['Your team asks', 'You decide', 'Next approvers', 'Booked or paid'],
    firsts: ['Open Pending Approvals and clear anything waiting', 'Have a look at Team Spend', 'Ask for your own trips and claims the same way as everyone'],
    stops: [
      ATTENTION(
        'Requests from your team that need your decision show up here first. Most have a deadline in working days. If it passes, the request moves on to the next approver without you.'
      ),
      {
        targets: ['nav:/claims/pending'],
        title: 'Approve, send back or reject',
        body: () =>
          "Your team's travel requests and claims. Open one to see the details and bills, then approve it, send it back with a note, or reject it.",
      },
      {
        targets: ['nav:/hr/exceptions'],
        title: 'Going past policy',
        body: () =>
          'When someone needs more than policy allows, like a hotel over the limit or a trip asked for too late, you decide here whether to allow it.',
      },
      {
        targets: ['nav:/team/claims'],
        title: "Your team's claims",
        body: () => 'Every claim from the people who report to you, and where each one is now.',
      },
      {
        targets: ['nav:/team/spend'],
        title: 'Team spend',
        body: () => 'What your team has spent, by category and against the team budget.',
      },
      OWN,
    ],
  },

  hrbp: {
    title: 'HR and Travel Desk tour',
    hello: "here's your part in Travora",
    intro: 'Claims and trips reach HR after the manager. For trips, the Travel Desk then makes sure everything is booked:',
    journey: ['Manager approves', 'You review', 'Travel Desk books', 'Employee claims'],
    firsts: ['Clear anything in your HR Review Queue', 'Check the Travel Desk for trips to book', 'Look over the current policy version'],
    stops: [
      ATTENTION('Requests at the HR step show up here first.'),
      {
        targets: ['nav:/claims/pending'],
        title: 'Review claims and trips',
        body: () =>
          'Check what the manager approved against policy, then approve, send back or reject. Most steps have a deadline in working days. If it passes, the request moves on without you.',
      },
      {
        targets: ['nav:/travel-desk'],
        title: 'Book approved trips',
        body: () =>
          "Approved trips waiting to be booked. Upload the ticket for each journey, or resend the request to the travel agent. You can also cancel a booked trip that hasn't started.",
      },
      {
        targets: ['nav:/hr/exceptions'],
        title: 'Going past policy',
        body: () => 'Requests over policy that are routed to HR for a decision.',
      },
      {
        targets: ['group:Policy Administration', 'nav:/admin/policy-versions'],
        title: 'Travel policy',
        body: () =>
          'Policy versions, levels, city groups and spending limits. A new version takes over on its start date and the old one is archived.',
      },
      {
        targets: ['nav:/compliance'],
        title: 'Compliance',
        body: () => 'Where spending went over policy, by department and category.',
      },
      OWN,
    ],
  },

  finance: {
    title: 'Finance tour',
    hello: "here's your part in Travora",
    intro: 'A claim reaches Finance after everyone else has approved it. Finance pays it and keeps the books:',
    journey: ['Approvers say yes', 'You pay', 'Ledger and GST', 'Reports'],
    firsts: ['Pay anything waiting in the Payment Queue', 'Check open advances', 'Ask for your own trips and claims the same way as everyone'],
    stops: [
      ATTENTION('Claims ready to pay show up here first.'),
      {
        targets: ['nav:/finance/payment-queue'],
        title: 'Pay approved claims',
        body: () =>
          'Record each payment with its UTR. Any TDS and advance are taken off, and the figures have to add up to the approved amount. Finance is always the last step, so nothing skips you.',
      },
      {
        targets: ['nav:/finance/advances'],
        title: 'Advances',
        body: () => "Give travel advances and settle them. An advance is taken off the person's next claims, oldest first.",
      },
      {
        targets: ['nav:/finance/erp-ledger'],
        title: 'Ledger',
        body: () => 'A ledger line for each paid claim, for the books.',
      },
      {
        targets: ['nav:/finance/gst-dashboard'],
        title: 'GST',
        body: () => 'GST and input tax credit from the bills on claims.',
      },
      {
        targets: ['nav:/reports'],
        title: 'Reports',
        body: () => 'Spend, approval time and GST reports to download as Excel, CSV or PDF.',
      },
      OWN,
    ],
  },

  payroll: {
    title: 'Payroll tour',
    hello: "here's your part in Travora",
    intro: 'Claims pass through Payroll on their way to Finance:',
    journey: ['Manager and HR approve', 'You check', 'Finance pays'],
    firsts: ['Clear anything in your Payroll Queue', 'Look up any claim in All Claims', 'Ask for your own trips and claims the same way as everyone'],
    stops: [
      ATTENTION('Claims at the Payroll step show up here first.'),
      {
        targets: ['nav:/claims/pending'],
        title: 'Check and pass on',
        body: () => 'Check each claim, then approve, send back or reject it. Most steps have a deadline in working days.',
      },
      {
        targets: ['nav:/claims/all'],
        title: 'All claims',
        body: () => 'Every claim in the company, to look up but not change.',
      },
      {
        targets: ['nav:/reports'],
        title: 'Reports',
        body: () => 'Spend and approval reports to download.',
      },
      OWN,
    ],
  },

  admin: {
    title: 'IT Admin tour',
    hello: "here's your part in Travora",
    intro: 'IT Admin sets Travora up and keeps it running. Most of the setup is done once:',
    journey: ['Add people', 'Set who approves', 'Set what each role can do', "Unstick what's stuck"],
    firsts: ['Check everyone has the right role and manager', 'Review the Approval Matrix', "Add this year's holidays"],
    stops: [
      {
        targets: ['nav:/admin/users'],
        title: 'People',
        body: () =>
          'Add people one at a time or from a CSV file. Each gets a welcome email, then their own tour at first sign-in. Turn on the Manager setting for anyone with a team.',
      },
      {
        targets: ['nav:/admin/workflow-config'],
        title: 'Who approves what',
        body: () => 'The approval steps for claims, travel, relocation and exceptions, in order, with their deadlines.',
      },
      {
        targets: ['nav:/admin/permission-matrix'],
        title: 'What each role can do',
        body: () => 'Turn pages and actions on or off for each role.',
      },
      {
        targets: ['nav:/admin/holiday-calendar'],
        title: 'Holidays',
        body: () => 'Approval deadlines skip these days, as well as weekends.',
      },
      {
        targets: ['nav:/admin/stuck-items'],
        title: 'Stuck items',
        body: () => "Move along an approval that's stuck, for example when the approver has left. Payments always stay with Finance.",
      },
      {
        targets: ['nav:/admin/audit-logs'],
        title: 'Audit log',
        body: () => 'Every change made in Travora, in a log that shows if anything was altered.',
      },
      OWN,
    ],
  },

  approver: {
    title: 'Approver tour',
    hello: "here's your part in Travora",
    intro: 'Some requests need a senior yes, like certain trips and bigger exceptions. They reach you after the earlier approvers:',
    journey: ['Earlier approvers', 'You decide', 'Booked or paid'],
    firsts: ['Clear anything in Pending Approvals', 'Check Exception Requests', 'Ask for your own trips and claims the same way as everyone'],
    stops: [
      ATTENTION('Requests that reach your step show up here first.'),
      {
        targets: ['nav:/claims/pending'],
        title: 'Approve, send back or reject',
        body: () => 'Open a request to see who approved it so far, then decide. Most steps have a deadline in working days.',
      },
      {
        targets: ['nav:/hr/exceptions'],
        title: 'Going past policy',
        body: () => 'Requests over policy that need your decision.',
      },
      OWN,
    ],
  },

  recruiter: {
    title: 'Recruiter tour',
    hello: "here's your part in Travora",
    intro: 'People who move for the job can claim their relocation costs. Their request starts with you:',
    journey: ['Joiner asks', 'You approve', 'Next approvers', 'They claim'],
    firsts: ['Clear any relocation requests waiting', 'Tell new joiners they can claim relocation in Travora', 'Ask for your own trips and claims the same way as everyone'],
    stops: [
      ATTENTION('Relocation requests waiting for you show up here first.'),
      {
        targets: ['nav:/claims/pending'],
        title: 'Relocation approvals',
        body: () =>
          "Check each request, then approve, send back or reject it. Once it's approved, the person can claim their moving costs.",
      },
      OWN,
    ],
  },
};

export const TOUR_KEYS = Object.keys(TOURS);

/** Home's own marks, always on screen there (`limits` only when they have a level). */
const HOME_MARKS = ['attention', 'bell'];

/** Every mark this person's screen has: their sidebar's (navConfig.navTourKeys) plus Home's. */
export function tourMarks(navKeys, profile) {
  const marks = new Set(navKeys);
  HOME_MARKS.forEach((mark) => marks.add(mark));
  if (profile?.impact_level_code) marks.add('limits');
  return marks;
}

/** Live settings the words quote. */
export function tourContext(profile) {
  const late = Number(profile?.workflow_claim_late_after_days);
  return { lateDays: Number.isFinite(late) && late > 0 ? late : 15 };
}

/** The stops of a tour this person can be shown: each keeps only its marks that are in `marks`,
 * in order, and a stop with none left is dropped. */
export function buildStops(key, marks, ctx) {
  const tour = TOURS[key];
  if (!tour) return [];
  return tour.stops.flatMap((stop) => {
    const targets = stop.targets.filter((mark) => marks.has(mark));
    return targets.length ? [{ targets, title: stop.title, body: stop.body(ctx) }] : [];
  });
}
