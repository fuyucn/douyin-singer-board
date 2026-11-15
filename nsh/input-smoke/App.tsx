import { mount, signal, View } from "nsh";
import { Input } from "nsh/base";

function InputSmoke() {
  const value = signal("");

  return (
    <View class="flex-1 items-center justify-center bg-white" style={{ padding: 32 }}>
      <Input
        autoFocus
        class="h-10 w-[480px] rounded border border-[#64748b] bg-white px-3 text-base text-[#111827]"
        placeholder="Type here to test Windows input"
        style={{ selectionColor: "#2563eb" }}
        value={value()}
        onChange={({ value: nextValue }) => value.set(nextValue)}
      />
    </View>
  );
}

mount(InputSmoke);
