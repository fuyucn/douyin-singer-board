import { mount, Text, View } from "nsh";

function StartupSmoke() {
  return (
    <View class="flex-1 items-center justify-center bg-white">
      <Text>NSH startup smoke test</Text>
    </View>
  );
}

mount(StartupSmoke);
