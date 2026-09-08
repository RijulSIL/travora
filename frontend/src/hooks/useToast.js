import { useToastStore } from '../store/toastStore';

export default function useToast() {
  const showToast = useToastStore((state) => state.showToast);
  return { showToast };
}
