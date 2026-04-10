import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useDatabaseMigrations } from './src/data/local/db';
import { useFonts } from './src/presentation/theme/useFonts';
import { appTheme } from './src/presentation/theme/theme';
import { RootNavigator } from './src/presentation/navigation/RootNavigator';
import { colours } from './src/presentation/theme/tokens';
import { supabase } from './src/data/remote/supabaseClient';
import { useAppStore } from './src/presentation/stores/appStore';
import { db } from './src/data/local/db';
import { AuditLogger } from './src/data/audit/AuditLogger';
import { EnsureHouseholdUseCase } from './src/domain/households/EnsureHouseholdUseCase';

const audit = new AuditLogger(db);

async function loadHousehold(
  userId: string,
  setHouseholdId: (id: string) => void,
  setPaydayDay: (day: number) => void,
): Promise<void> {
  const uc = new EnsureHouseholdUseCase(db, audit, userId);
  const result = await uc.execute();
  if (result.success) {
    setHouseholdId(result.data.id);
    setPaydayDay(result.data.paydayDay);
  } else {
    console.error('[loadHousehold] Failed to ensure household:', result.error);
  }
}

export default function App(): React.JSX.Element {
  const { fontsLoaded, fontError } = useFonts();
  const { success: dbReady, error: dbError } = useDatabaseMigrations();
  const setSession = useAppStore((s) => s.setSession);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const clearHousehold = useAppStore((s) => s.clearHousehold);
  const [sessionRestored, setSessionRestored] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session ?? null;
      setSession(session);
      if (session) {
        await loadHousehold(session.user.id, setHouseholdId, setPaydayDay);
      }
      setSessionRestored(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session ?? null);
      if (session) {
        await loadHousehold(session.user.id, setHouseholdId, setPaydayDay);
      } else {
        clearHousehold();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [setSession, setHouseholdId, setPaydayDay, clearHousehold]);

  if (fontError || dbError) {
    return (
      <View style={styles.center}>
        <Text>Error: {(fontError ?? dbError)?.message}</Text>
      </View>
    );
  }

  if (!fontsLoaded || !dbReady || !sessionRestored) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colours.surface },
});
