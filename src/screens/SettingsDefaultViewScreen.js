import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ViewIcon from '../components/ViewIcon';
import { useTheme } from '../theme';
import {
  HOME_VIEWS,
  getDefaultHomeView,
  setDefaultHomeView,
} from '../utils/preferences';

const VIEW_LABEL = {
  list: 'Notes list',
  calendar: 'Calendar',
  threads: 'Threads',
};
const VIEW_HINT = {
  list: 'Beads of life: your entries in time bands',
  calendar: 'Book of days: month grid with reminders',
  threads: 'Threads of life: chains and collections',
};

export default function SettingsDefaultViewScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState(null);

  useEffect(() => {
    getDefaultHomeView().then(setView);
  }, []);

  const onPick = async (next) => {
    setView(next);
    await setDefaultHomeView(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Default view</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHint}>
          The app opens this view when you unlock it.
        </Text>

        <View style={styles.card}>
          {HOME_VIEWS.map((v, i) => {
            const active = view === v;
            return (
              <TouchableOpacity
                key={v}
                style={[
                  styles.row,
                  i < HOME_VIEWS.length - 1 && styles.rowDivider,
                ]}
                onPress={() => onPick(v)}
                activeOpacity={0.7}
              >
                <View style={styles.rowIcon}>
                  <ViewIcon view={v} size={20} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{VIEW_LABEL[v]}</Text>
                  <Text style={styles.rowHint}>{VIEW_HINT[v]}</Text>
                </View>
                {active ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={colors.primary}
                  />
                ) : (
                  <View style={styles.radioOff} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 12,
    },
    headerTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    sectionHint: {
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 16,
      lineHeight: 18,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 12,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    radioOff: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
  });
