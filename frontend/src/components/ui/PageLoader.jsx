import { Loader2 } from 'lucide-react';

export default function PageLoader() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center space-y-4">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand/20"></div>
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
      <p className="text-sm font-medium text-slate-500 animate-pulse">Loading...</p>
    </div>
  );
}
