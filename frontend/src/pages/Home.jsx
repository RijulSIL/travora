import HomeDashboard from './dashboards/HomeDashboard';

// One Home for every role: what it shows follows the viewer's permissions and approval scope
// (see HomeDashboard), not a per-role dashboard.
export default function Home() {
  return <HomeDashboard />;
}
