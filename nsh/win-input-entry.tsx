// Test-only harness: one field, its value's mirror text and a title line,
// at fixed positions on white, so scripts/check_win_input.py can find the
// field by its blue border and measure where the field's text, its
// selection and the reference text drew. The mirror shows the very string
// the field holds, in the engine's own text (DWrite on Windows), so the
// pixels of the two answer whether the field's font matches the app's.
import { createSignal, mount, Text, View } from "nsh";
import { Input } from "nsh/base";
import { VALUE } from "./win-input-value";

function Harness() {
  const [value, setValue] = createSignal("");
  return (
    <View class="flex-col bg-white" style={{ width: 800, height: 600 }}>
      <View class="flex-col gap-6 p-10">
        <Text class="text-sm text-[#191d24]" testID="mirror">{VALUE}</Text>
        <View class="h-9 w-[420px] rounded border border-[#2563eb] bg-white" testID="field-wrap">
          <Input class="h-full w-full text-sm" testID="field" value={value()} onChange={setValue} />
        </View>
        <Text class="text-sm text-[#191d24]" testID="title">标题字样 Sample 123</Text>
      </View>
    </View>
  );
}
mount(Harness);
