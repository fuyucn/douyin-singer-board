import { mount, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { createSqliteStore } from "./src/sqliteStore";

// Explicitly isolated: this verification entry never opens application files.
function Fixture() {
  const storage = createSqliteStore(null);
  const output = signal("loading");
  const refresh = async () => output.set(await storage.exportJson());
  const write = async () => {
    await storage.setItems({
      "board.config": JSON.stringify({ room_id: "sqlite-room" }),
      "board.theme": "dark",
      "kugou.session": "fixture-session",
    });
    await refresh();
  };
  const invalid = async () => {
    try {
      await storage.setItems({ "board.config": "invalid json", "board.theme": "light" });
    } catch {
      output.set("rejected: " + await storage.exportJson());
    }
  };
  const remove = async () => {
    await storage.removeItem("kugou.session");
    await refresh();
  };
  void refresh();
  return <View style={{ flex: 1, padding: 20, gap: 8 }}>
    <Text testID="sqlite-output">{output()}</Text>
    <Button testID="sqlite-write" onPress={write} style={{ height: 40 }}><Text>Write SQLite</Text></Button>
    <Button testID="sqlite-invalid" onPress={invalid} style={{ height: 40 }}><Text>Invalid batch</Text></Button>
    <Button testID="sqlite-remove" onPress={remove} style={{ height: 40 }}><Text>Remove session</Text></Button>
  </View>;
}
mount(Fixture);
