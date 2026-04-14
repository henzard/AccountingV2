import { useNavigation, NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from './types';

// TODO: Extend RootStackParamList in types.ts to cover all routes as the
// navigation tree grows. For now this provides typed navigation for all
// currently known root stack screens.
export function useAppNavigation(): NavigationProp<RootStackParamList> {
  return useNavigation<NavigationProp<RootStackParamList>>();
}
