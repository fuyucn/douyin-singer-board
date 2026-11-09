// Regression harness for fixed-height TEXT buttons. NSH's Button is a column
// host: without centering, a Text child is stretched to the full width and
// pinned to the top. The original shadcn Button is inline-flex centered.
import { mount, Text, View, signal } from "nsh";
import { Button } from "nsh/base";

const tick = signal(0);
const boxes: Record<string, string> = {};
const rec = (k: string, v: string) => { boxes[k] = v; tick.update((n) => n + 1); };
const bounds = (e: any) => `${e.bounds.origin.x},${e.bounds.origin.y},${e.bounds.size.width},${e.bounds.size.height}`;

function App() {
  const report = () => {
    tick();
    return `TEXT|${Object.entries(boxes).map(([k, v]) => `${k}=${v}`).join(";")}`;
  };
  return (
    <View class="flex-col gap-4 p-4">
      <Button class="h-8 bg-muted px-2.5" onLayout={(e: any) => rec("plainBtn", bounds(e))}>
        <Text onLayout={(e: any) => rec("plainText", bounds(e))}>添加</Text>
      </Button>
      <Button class="h-8 items-center justify-center bg-muted px-2.5" onLayout={(e: any) => rec("centeredBtn", bounds(e))}>
        <Text onLayout={(e: any) => rec("centeredText", bounds(e))}>添加</Text>
      </Button>
      <Button class="flex-row items-center justify-center gap-1 h-8 bg-muted px-2.5" onLayout={(e: any) => rec("rowBtn", bounds(e))}>
        <View class="h-3.5 w-3.5 bg-primary" onLayout={(e: any) => rec("rowIcon", bounds(e))} />
        <Text onLayout={(e: any) => rec("rowText", bounds(e))}>清空列表</Text>
      </Button>
      <Text>{report()}</Text>
    </View>
  );
}
mount(App);
