import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Modal,
  Image,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";

const COLORS = {
  background: "#09090B",
  surface: "#18181B",
  surfaceElevated: "#27272A",
  primary: "#FFD600",
  primaryActive: "#E6C200",
  textPrimary: "#FAFAFA",
  textSecondary: "#A1A1AA",
  textMuted: "#52525B",
  danger: "#EF4444",
  border: "#27272A",
  overlay: "rgba(0, 0, 0, 0.7)",
};

const TIP_PRESETS = [10, 15, 18, 20, 25];
const STORAGE_KEY = "splitlens:lastSplit:v1";
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type SplitMode = "count" | "named";

type PersistedState = {
  bill: string;
  tip: number;
  customTip: string;
  isCustomTip: boolean;
  mode: SplitMode;
  peopleCount: number;
  names: string[];
  roundUp: boolean;
};

const defaultState: PersistedState = {
  bill: "",
  tip: 18,
  customTip: "",
  isCustomTip: false,
  mode: "count",
  peopleCount: 2,
  names: [],
  roundUp: false,
};

const buzz = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(style).catch(() => {});
  }
};

const formatMoney = (n: number) =>
  Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";

export default function SplitLens() {
  const [state, setState] = useState<PersistedState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  const [showPeopleSheet, setShowPeopleSheet] = useState(false);
  const [showReceiptSheet, setShowReceiptSheet] = useState(false);
  const [newName, setNewName] = useState("");
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // Hydrate last split from storage.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<PersistedState>;
          setState((prev) => ({ ...prev, ...parsed }));
        }
      } catch {
        // ignore corrupted storage — keep defaults.
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Persist on every change (debounced via microtask).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, hydrated]);

  const patch = useCallback((p: Partial<PersistedState>) => {
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  // ----- Calculations -------------------------------------------------------
  const calc = useMemo(() => {
    const bill = parseFloat(state.bill) || 0;
    const tipPct = state.isCustomTip
      ? parseFloat(state.customTip) || 0
      : state.tip;
    const tipAmount = (bill * tipPct) / 100;
    const total = bill + tipAmount;
    const headCount =
      state.mode === "named"
        ? Math.max(state.names.length, 1)
        : Math.max(state.peopleCount, 1);
    let perPerson = total / headCount;
    if (state.roundUp) perPerson = Math.ceil(perPerson);
    const roundedTotal = state.roundUp ? perPerson * headCount : total;
    return { bill, tipPct, tipAmount, total, perPerson, headCount, roundedTotal };
  }, [state]);

  // ----- Handlers -----------------------------------------------------------
  const selectTip = (pct: number) => {
    buzz(Haptics.ImpactFeedbackStyle.Light);
    patch({ tip: pct, isCustomTip: false });
  };

  const enableCustomTip = () => {
    buzz();
    patch({ isCustomTip: true });
  };

  const incPeople = () => {
    buzz();
    patch({ peopleCount: Math.min(state.peopleCount + 1, 50) });
  };

  const decPeople = () => {
    buzz();
    patch({ peopleCount: Math.max(state.peopleCount - 1, 1) });
  };

  const addName = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (state.names.length >= 50) return;
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    patch({ names: [...state.names, trimmed] });
    setNewName("");
  };

  const removeName = (idx: number) => {
    buzz();
    patch({ names: state.names.filter((_, i) => i !== idx) });
  };

  const toggleMode = () => {
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    const next: SplitMode = state.mode === "count" ? "named" : "count";
    patch({ mode: next });
  };

  const resetAll = () => {
    if (Platform.OS === "web") {
      setState(defaultState);
      setReceiptUri(null);
      setScanMessage(null);
      return;
    }
    Alert.alert("Reset split?", "Clear bill, tip, and people.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          buzz(Haptics.ImpactFeedbackStyle.Heavy);
          setState(defaultState);
          setReceiptUri(null);
          setScanMessage(null);
        },
      },
    ]);
  };

  // ----- Receipt scan -------------------------------------------------------
  const pickReceiptImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setScanMessage("Permission denied — enter amount manually.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setReceiptUri(asset.uri);
      await scanReceipt(asset.uri);
    } catch (e: any) {
      setScanMessage(`Couldn't open gallery: ${e?.message || e}`);
    }
  };

  const scanReceipt = async (uri: string) => {
    setScanning(true);
    setScanMessage(null);
    try {
      // Try backend placeholder. If it fails, fall back to a local simulated total.
      const form = new FormData();
      // @ts-ignore — RN FormData file shape
      form.append("file", {
        uri,
        name: "receipt.jpg",
        type: "image/jpeg",
      });
      const res = await fetch(`${BACKEND_URL}/api/receipt/scan`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.ok && typeof data.total === "number") {
        patch({ bill: data.total.toFixed(2) });
        setScanMessage(`Detected total: ${formatMoney(data.total)} (${data.source})`);
        buzz(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        throw new Error(data?.message || "No total detected");
      }
    } catch (e: any) {
      // Local fallback — keep the app usable offline.
      const fallback = Math.round((20 + Math.random() * 120) * 100) / 100;
      patch({ bill: fallback.toFixed(2) });
      setScanMessage(
        `Offline scan — simulated total ${formatMoney(fallback)}. You can still edit manually.`,
      );
    } finally {
      setScanning(false);
    }
  };

  // ----- Render -------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header} testID="splitlens-header">
              <View style={styles.brandRow}>
                <View style={styles.brandDot} />
                <Text style={styles.brand}>SplitLens</Text>
              </View>
              <TouchableOpacity
                onPress={resetAll}
                style={styles.resetBtn}
                testID="quick-reset-button"
                accessibilityLabel="Reset split"
              >
                <Feather name="rotate-ccw" size={16} color={COLORS.textSecondary} />
                <Text style={styles.resetTxt}>Reset</Text>
              </TouchableOpacity>
            </View>

            {/* Hero display */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>PER PERSON</Text>
              <Text
                style={styles.heroAmount}
                testID="hero-per-person-amount"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatMoney(calc.perPerson)}
              </Text>
              <View style={styles.heroMetaRow}>
                <HeroStat label="TIP" value={formatMoney(calc.tipAmount)} testID="hero-tip" />
                <View style={styles.heroDivider} />
                <HeroStat
                  label="TOTAL"
                  value={formatMoney(calc.roundedTotal)}
                  testID="bill-total-display"
                />
                <View style={styles.heroDivider} />
                <HeroStat
                  label="PEOPLE"
                  value={String(calc.headCount)}
                  testID="hero-people"
                />
              </View>
            </View>

            {/* Bill input */}
            <Section label="BILL AMOUNT">
              <View style={styles.billInputWrap}>
                <Text style={styles.billPrefix}>$</Text>
                <TextInput
                  value={state.bill}
                  onChangeText={(t) => patch({ bill: t.replace(/[^0-9.]/g, "") })}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                  style={styles.billInput}
                  testID="bill-amount-input"
                  selectionColor={COLORS.primary}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={styles.scanInline}
                  onPress={() => {
                    buzz();
                    setShowReceiptSheet(true);
                  }}
                  testID="scan-receipt-button"
                >
                  <Feather name="camera" size={16} color={COLORS.background} />
                  <Text style={styles.scanInlineTxt}>Scan</Text>
                </TouchableOpacity>
              </View>
            </Section>

            {/* Tip */}
            <Section label="TIP">
              <View style={styles.chipRow}>
                {TIP_PRESETS.map((p) => {
                  const active = !state.isCustomTip && state.tip === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => selectTip(p)}
                      style={[styles.chip, active && styles.chipActive]}
                      testID={`tip-chip-${p}`}
                    >
                      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                        {p}%
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  onPress={enableCustomTip}
                  style={[styles.chip, state.isCustomTip && styles.chipActive]}
                  testID="tip-chip-custom"
                >
                  <Text
                    style={[
                      styles.chipTxt,
                      state.isCustomTip && styles.chipTxtActive,
                    ]}
                  >
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>
              {state.isCustomTip && (
                <View style={styles.customTipWrap}>
                  <TextInput
                    value={state.customTip}
                    onChangeText={(t) =>
                      patch({ customTip: t.replace(/[^0-9.]/g, "") })
                    }
                    keyboardType="decimal-pad"
                    placeholder="Enter %"
                    placeholderTextColor={COLORS.textMuted}
                    style={styles.customTipInput}
                    testID="custom-tip-input"
                    selectionColor={COLORS.primary}
                  />
                  <Text style={styles.customTipSuffix}>%</Text>
                </View>
              )}
            </Section>

            {/* People */}
            <Section
              label="PEOPLE"
              right={
                <TouchableOpacity
                  onPress={toggleMode}
                  style={styles.modeToggle}
                  testID="split-type-toggle"
                >
                  <Text style={styles.modeToggleTxt}>
                    {state.mode === "count" ? "Use names" : "Use count"}
                  </Text>
                  <Feather
                    name={state.mode === "count" ? "users" : "hash"}
                    size={14}
                    color={COLORS.primary}
                  />
                </TouchableOpacity>
              }
            >
              {state.mode === "count" ? (
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    onPress={decPeople}
                    style={styles.stepperBtn}
                    testID="people-count-decrement"
                  >
                    <Feather name="minus" size={22} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.stepperValue} testID="people-count-value">
                    {state.peopleCount}
                  </Text>
                  <TouchableOpacity
                    onPress={incPeople}
                    style={styles.stepperBtn}
                    testID="people-count-increment"
                  >
                    <Feather name="plus" size={22} color={COLORS.textPrimary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.managePeopleBtn}
                  onPress={() => {
                    buzz();
                    setShowPeopleSheet(true);
                  }}
                  testID="manage-people-button"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.managePeopleCount}>
                      {state.names.length} {state.names.length === 1 ? "person" : "people"}
                    </Text>
                    <Text style={styles.managePeopleSub} numberOfLines={1}>
                      {state.names.length > 0
                        ? state.names.join(" · ")
                        : "Tap to add names"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </Section>

            {/* Round toggle */}
            <View style={styles.roundRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.roundLabel}>Round up per person</Text>
                <Text style={styles.roundSub}>
                  Rounds everyone up to the nearest dollar
                </Text>
              </View>
              <Switch
                value={state.roundUp}
                onValueChange={(v) => {
                  buzz();
                  patch({ roundUp: v });
                }}
                trackColor={{ false: COLORS.surfaceElevated, true: COLORS.primary }}
                thumbColor={COLORS.textPrimary}
                testID="round-total-toggle"
              />
            </View>

            <View style={{ height: 32 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Named-people bottom sheet */}
      <BottomSheet
        visible={showPeopleSheet}
        onClose={() => setShowPeopleSheet(false)}
        title="Named people"
        testID="named-people-sheet"
      >
        <View style={styles.addPersonRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Add a name"
            placeholderTextColor={COLORS.textMuted}
            style={styles.addPersonInput}
            testID="add-person-input-field"
            onSubmitEditing={addName}
            returnKeyType="done"
            selectionColor={COLORS.primary}
          />
          <TouchableOpacity
            onPress={addName}
            style={styles.addPersonBtn}
            testID="add-person-submit"
          >
            <Feather name="plus" size={20} color={COLORS.background} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {state.names.length === 0 ? (
            <Text style={styles.emptyPeople}>
              No names yet. Add people to split evenly by name.
            </Text>
          ) : (
            state.names.map((n, i) => (
              <View key={`${n}-${i}`} style={styles.personRow} testID={`person-row-${i}`}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarTxt}>
                    {n.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.personName}>{n}</Text>
                <TouchableOpacity
                  onPress={() => removeName(i)}
                  style={styles.removeBtn}
                  testID={`remove-person-${i}`}
                >
                  <Feather name="x" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </BottomSheet>

      {/* Receipt scanner bottom sheet */}
      <BottomSheet
        visible={showReceiptSheet}
        onClose={() => setShowReceiptSheet(false)}
        title="Scan receipt"
        testID="receipt-scanner-sheet"
      >
        <View style={styles.receiptBody}>
          {receiptUri ? (
            <Image source={{ uri: receiptUri }} style={styles.receiptPreview} />
          ) : (
            <View style={styles.receiptEmpty}>
              <Feather name="image" size={32} color={COLORS.textMuted} />
              <Text style={styles.receiptEmptyTxt}>
                Pick a receipt photo to auto-fill the total.
              </Text>
              <Text style={styles.receiptEmptyNote}>
                OCR is simulated in this build — you can always edit the total.
              </Text>
            </View>
          )}

          {scanning && (
            <View style={styles.scanStatus}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.scanStatusTxt}>Analysing receipt…</Text>
            </View>
          )}

          {scanMessage && !scanning && (
            <Text style={styles.scanMessage} testID="scan-message">
              {scanMessage}
            </Text>
          )}

          <TouchableOpacity
            onPress={pickReceiptImage}
            style={styles.primaryBtn}
            disabled={scanning}
            testID="pick-receipt-button"
          >
            <Feather name="upload" size={18} color={COLORS.background} />
            <Text style={styles.primaryBtnTxt}>
              {receiptUri ? "Pick another" : "Upload receipt"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setShowReceiptSheet(false);
            }}
            style={styles.secondaryBtn}
            testID="receipt-manual-entry"
          >
            <Text style={styles.secondaryBtnTxt}>Enter manually</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

// ----- Subcomponents --------------------------------------------------------

function HeroStat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={styles.heroStatValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

function Section({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function BottomSheet({
  visible,
  onClose,
  title,
  children,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.sheetRoot} testID={testID}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.sheetClose}>
                <Feather name="x" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ----- Styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  brand: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resetTxt: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },

  // Hero
  hero: {
    alignItems: "center",
    paddingVertical: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 32,
  },
  heroLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: 8,
  },
  heroAmount: {
    color: COLORS.textPrimary,
    fontSize: 64,
    fontWeight: "800",
    letterSpacing: -2,
    paddingHorizontal: 16,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    paddingHorizontal: 16,
  },
  heroDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
    marginHorizontal: 12,
  },
  heroStat: { alignItems: "center", minWidth: 70 },
  heroStatLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginBottom: 4,
  },
  heroStatValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },

  // Section
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
  },

  // Bill input
  billInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingLeft: 18,
    paddingRight: 6,
    height: 64,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  billPrefix: {
    color: COLORS.textSecondary,
    fontSize: 28,
    fontWeight: "700",
    marginRight: 6,
  },
  billInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    paddingVertical: 0,
  },
  scanInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
  },
  scanInlineTxt: {
    color: COLORS.background,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // Chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(255, 214, 0, 0.08)",
  },
  chipTxt: { color: COLORS.textSecondary, fontWeight: "700", fontSize: 14 },
  chipTxtActive: { color: COLORS.primary },

  customTipWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    height: 52,
  },
  customTipInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    paddingVertical: 0,
  },
  customTipSuffix: {
    color: COLORS.textSecondary,
    fontSize: 18,
    fontWeight: "700",
  },

  // Mode toggle
  modeToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modeToggleTxt: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },

  // Stepper
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    height: 64,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -1,
  },

  // Manage people button
  managePeopleBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  managePeopleCount: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  managePeopleSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },

  // Round toggle row
  roundRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  roundLabel: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  roundSub: { color: COLORS.textSecondary, fontSize: 12 },

  // Sheet
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.overlay },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceElevated,
  },

  // Add person
  addPersonRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  addPersonInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: COLORS.textPrimary,
    fontSize: 16,
    height: 52,
  },
  addPersonBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyPeople: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 24,
  },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTxt: { color: COLORS.primary, fontWeight: "800", fontSize: 14 },
  personName: { flex: 1, color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  // Receipt sheet
  receiptBody: { gap: 16 },
  receiptEmpty: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 10,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 16,
    paddingHorizontal: 20,
  },
  receiptEmptyTxt: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  receiptEmptyNote: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textAlign: "center",
  },
  receiptPreview: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    resizeMode: "cover",
    backgroundColor: COLORS.surfaceElevated,
  },
  scanStatus: { flexDirection: "row", alignItems: "center", gap: 10 },
  scanStatusTxt: { color: COLORS.textSecondary, fontSize: 13 },
  scanMessage: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 52,
  },
  primaryBtnTxt: {
    color: COLORS.background,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryBtnTxt: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
});
