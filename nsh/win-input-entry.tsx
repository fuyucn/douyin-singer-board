// Test-only harness: fields that differ only in their font, one value each,
// so a run answers which faces render CJK at all (the mirror and title are
// the engine's own text for comparison). scripts/check_win_input.py finds
// the bordered fields top to bottom.
import { mount, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { VALUE } from "./win-input-value";

function Field(props: { testID: string; family?: string }) {
  const value = signal("");
  return (
    <View
      class="h-9 w-[420px] rounded border border-[#2563eb] bg-white"
      testID={`${props.testID}-wrap`}
    >
      <Input
        class="h-full w-full text-sm"
        testID={props.testID}
        value={value()}
        onChange={({ value: v }) => value.set(v)}
        style={props.family ? { fontFamily: props.family } : undefined}
      />
    </View>
  );
}

function Harness() {
  return (
    <View class="flex-col bg-white" style={{ width: 800, height: 640 }}>
      <View class="flex-col gap-4 p-10">
        <Text class="text-sm text-[#191d24]" testID="mirror">{VALUE}</Text>
        <Field testID="field" />
        <Field testID="field-yahei" family="Microsoft YaHei UI" />
        <Field testID="field-simsun" family="SimSun" />
        <Text class="text-sm text-[#191d24]" testID="title">标题字样 Sample 123</Text>
      </View>
    </View>
  );
}
mount(Harness);
