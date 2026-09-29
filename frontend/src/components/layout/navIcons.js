import {
  Home, Clock, AlertTriangle, Users, TrendingUp, CheckSquare,
  Plane, ReceiptIndianRupee, PlusCircle, Settings, Map,
  IndianRupee, Folder, Mail, Calendar, Building, User, History, ClipboardList,
} from 'lucide-react';

/** Shared semantic-key -> icon lookup for every nav item's `icon` field (see navConfig.js). */
export const NAV_ICON_MAP = {
  home: Home,
  clipboard: ClipboardList,
  clock: Clock,
  alert: AlertTriangle,
  users: Users,
  chart: TrendingUp,
  check: CheckSquare,
  plane: Plane,
  add: PlusCircle,
  receipt: ReceiptIndianRupee,
  settings: Settings,
  city: Map,
  money: IndianRupee,
  folder: Folder,
  mail: Mail,
  calendar: Calendar,
  building: Building,
  trend: TrendingUp,
  card: ReceiptIndianRupee,
  bank: Building,
  user: User,
  history: History,
};
