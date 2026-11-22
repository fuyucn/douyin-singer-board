import { Text, token, View } from "nsgo";
import { Tooltip } from "nsgo/base";
import { Icon } from "nsgo/ui";

export function Action(props: { label: string; testID?: string; onPress: () => void; disabled?: boolean; locked?: boolean; danger?: boolean; icon?: string; subtle?: boolean; stretch?: boolean }) {
  return <View role="button" accessibilityLabel={props.label} testID={props.testID} disabled={props.disabled || props.locked} onPress={() => props.onPress()}
    class="flex-row items-center justify-center gap-1.5 rounded-[5px] hover:bg-secondary"
    classList={{ "opacity-40": props.disabled, "flex-1": props.stretch, "shrink-0": !props.stretch, "h-6 px-1.5": props.subtle, "h-8 border px-2.5": !props.subtle,
      "border-destructive": !props.subtle && props.stretch && props.danger, "border-border": !props.subtle && !(props.stretch && props.danger) }}>
    <If when={props.icon}><Icon name={props.icon} size={props.subtle ? 12 : 14} color={props.danger ? token("destructive") : props.subtle ? token("faint") : token("foreground")} /></If>
    <Text class={props.subtle ? "text-[11px]" : "text-xs"} classList={{ "text-destructive": props.danger, "text-faint": !!props.subtle && !props.danger, "text-foreground": !props.subtle && !props.danger }}>{props.label}</Text>
  </View>;
}

export function IconAction(props: { label: string; icon: string; testID?: string; onPress: () => void; disabled?: boolean; locked?: boolean; appearance?: "start" | "stop"; compact?: boolean; danger?: boolean; hint?: string }) {
  const disabled = () => props.disabled || props.locked;
  const button = <View role="button" accessibilityLabel={props.label} testID={props.testID} disabled={disabled()} onPress={() => props.onPress()}
      class="shrink-0 items-center justify-center rounded-[6px]"
      classList={{ "opacity-40": props.disabled, "size-8": !!props.appearance, "size-7": !!props.compact, "size-[30px]": !props.appearance && !props.compact,
        "bg-foreground hover:bg-muted-foreground": props.appearance === "start", "bg-destructive hover:opacity-90": props.appearance === "stop", "hover:bg-secondary": !props.appearance }}>
      <Icon name={props.icon} size={props.compact ? 14 : 15} color={props.appearance === "start" ? token("background") : props.appearance === "stop" ? "#ffffff" : props.danger ? token("destructive") : token("muted-foreground")} />
    </View>;
  return <Tooltip testID={props.testID && props.testID + "-hint"} placement={props.appearance ? "bottom" : "top"}
    class="shrink-0" popupClass="max-w-[280px] rounded-[6px] bg-foreground px-2 py-1"
    trigger={<View focusable={disabled()} accessibilityLabel={disabled() ? props.hint || props.label : undefined}>{button}</View>}>
    <Text class="text-xs text-background">{props.hint || props.label}</Text>
  </Tooltip>;
}
