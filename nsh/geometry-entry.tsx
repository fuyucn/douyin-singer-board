// Test-only harness: every icon-button size used by the original app.
import { mount, Text, View } from "nsh";
import { IconButton, iconCenterDelta, iconGeometry, geomTick } from "./ui";
export { iconCenterDelta, iconGeometry };

function geometryReport(): string {
  geomTick();
  const parts = Object.entries(iconGeometry)
    .map(([key, g]) => {
      const d = iconCenterDelta(g);
      return `${key}=${d.dx.toFixed(2)},${d.dy.toFixed(2)},${g.hasButton ? "B" : "-"}${g.hasIcon ? "I" : "-"},${g.buttonW}x${g.buttonH},${g.iconW}x${g.iconH}`;
    });
  return `GEOM|${parts.join(";")}`;
}

function Harness() {
  const noop = () => {};
  return (
    <View class="flex-col gap-2 p-4">
      {IconButton({ geomKey: "header-30", name: "info", onPress: noop, class: "h-[30px] w-[30px] bg-muted", iconClass: "h-[15px] w-[15px]" })}
      {IconButton({ geomKey: "start-30", name: "play", onPress: noop, class: "h-[30px] w-[30px] rounded-[6px] bg-success", iconClass: "h-[15px] w-[15px]", color: "background" })}
      {IconButton({ geomKey: "row-28", name: "copy", onPress: noop, class: "h-7 w-7 bg-muted", iconClass: "h-3.5 w-3.5" })}
      {IconButton({ geomKey: "small-24", name: "x", onPress: noop, class: "h-6 w-6 bg-muted", iconClass: "h-3.5 w-3.5" })}
      {IconButton({ geomKey: "add-32", name: "plus", onPress: noop, class: "h-8 w-8 bg-muted", iconClass: "h-4 w-4" })}
      <View class="flex-row">{IconButton({ geomKey: "with-text", name: "trash", text: "清空列表", onPress: noop, class: "h-7 bg-muted px-2.5", iconClass: "h-3.5 w-3.5" })}</View>
      <Text>{geometryReport()}</Text>
    </View>
  );
}
mount(Harness);
