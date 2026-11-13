import { useWindowDimensions } from 'react-native';
import { breakpointFor } from './breakpoints';
export function useBreakpoint() { const { width, height } = useWindowDimensions(); return breakpointFor(width, height); }
