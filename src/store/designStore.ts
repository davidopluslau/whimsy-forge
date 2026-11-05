import { create } from 'zustand';
import type { Design } from '../model/design';

type DesignStore = {
  design: Design | null;
  setDesign: (design: Design | null) => void;
};

export const useDesignStore = create<DesignStore>((set) => ({
  design: null,
  setDesign: (design) => set({ design }),
}));
