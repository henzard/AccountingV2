import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { MeterType } from '../../domain/meterReadings/MeterReadingEntity';

export type OnboardingStackParamList = {
  Welcome: undefined;
  Income: undefined;
  ExpenseCategories: undefined;
  Payday: undefined;
  MeterSetup: undefined;
  ScoreIntro: undefined;
  Finish: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  OnboardingWizard: undefined;
};

export type CreateHouseholdStackParamList = {
  CreateHouseholdGate: undefined;
  JoinHouseholdGate: undefined;
};

export type DashboardStackParamList = {
  DashboardHome: undefined;
  AddEditEnvelope:
    | {
        envelopeId?: string;
        preselectedType?: import('../../domain/envelopes/EnvelopeEntity').EnvelopeType;
      }
    | undefined;
  BabySteps: undefined;
};

export type TransactionsStackParamList = {
  TransactionList: undefined;
  AddTransaction: undefined;
};

export type MetersStackParamList = {
  MeterDashboard: undefined;
  AddReading: { meterType: MeterType };
  RateHistory: { meterType: MeterType };
};

export type SnowballStackParamList = {
  SnowballDashboard: undefined;
  AddDebt: undefined;
  DebtDetail: { debtId: string };
  LogPayment: { debtId: string };
};

export type SettingsStackParamList = {
  SettingsHome: undefined;
  NotificationPreferences: undefined;
  CrashLog: undefined;
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
  CreateHouseholdFlow: undefined;
  Onboarding: undefined;
  Main: undefined;
  HouseholdPicker: undefined;
  CreateHousehold: undefined;
  ShareInvite: { householdId: string; householdName: string };
  JoinHousehold: undefined;
  SlipScanning: undefined;
};

// --- Screen props ---

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export type DashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<DashboardStackParamList, 'DashboardHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddEditEnvelopeScreenProps = NativeStackScreenProps<
  DashboardStackParamList,
  'AddEditEnvelope'
>;

export type BabyStepsScreenProps = NativeStackScreenProps<DashboardStackParamList, 'BabySteps'>;

export type TransactionListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<TransactionsStackParamList, 'TransactionList'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddTransactionScreenProps = NativeStackScreenProps<
  TransactionsStackParamList,
  'AddTransaction'
>;

export type MeterDashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<MetersStackParamList, 'MeterDashboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddReadingScreenProps = NativeStackScreenProps<MetersStackParamList, 'AddReading'>;

export type RateHistoryScreenProps = NativeStackScreenProps<MetersStackParamList, 'RateHistory'>;

export type SnowballDashboardScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SnowballStackParamList, 'SnowballDashboard'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type AddDebtScreenProps = NativeStackScreenProps<SnowballStackParamList, 'AddDebt'>;

export type DebtDetailScreenProps = NativeStackScreenProps<SnowballStackParamList, 'DebtDetail'>;

export type LogPaymentScreenProps = NativeStackScreenProps<SnowballStackParamList, 'LogPayment'>;

export type SettingsScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>,
  BottomTabScreenProps<MainTabParamList>
>;

export type NotificationPreferencesScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  'NotificationPreferences'
>;

export type HouseholdPickerScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'HouseholdPicker'
>;
export type CreateHouseholdScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'CreateHousehold'
>;
export type ShareInviteScreenProps = NativeStackScreenProps<RootStackParamList, 'ShareInvite'>;
export type JoinHouseholdScreenProps = NativeStackScreenProps<RootStackParamList, 'JoinHousehold'>;
