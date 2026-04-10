import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  OnboardingWizard: undefined;
};

export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope: { envelopeId?: string } | undefined;
};

export type MainTabParamList = {
  DashboardTab: undefined;
  Transactions: undefined;
  Meters: undefined;
  Snowball: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export type DashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddEditEnvelopeScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'AddEditEnvelope'
>;
