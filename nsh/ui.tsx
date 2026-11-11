// Shared UI primitives. NSH's <Button> is an unstyled host: it lays children
// out in a column from the top-left. The original app's shadcn Button always
// centers its content, so every icon-only button must go through IconButton.
import { colorScheme, Image, signal, Text, token, View } from "nsh";
import { Button } from "nsh/base";

export const ICON_PATHS: Record<string, string> = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  // Original uses lucide <Square className="fill-current"/> for Stop.
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  "list-plus": '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 12H3"/><path d="M21 18H3"/><path d="M18 15v6"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

/** Called as a plain function (not a <Icon/> component): NSH keeps a child
 *  component's first render, which froze SVG colors across theme switches. */
export function Icon(props: {
  name: string;
  class?: string;
  color?: string;
  scheme?: string;
  onLayout?: (e: { bounds: any }) => void;
}) {
  void props.scheme;
  const c = props.color && props.color.startsWith("#")
    ? props.color
    : token((props.color ?? "muted-foreground") as any);
  const svgFill = props.name === "square" ? c : "none";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${svgFill}" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[props.name] ?? ""}</svg>`;
  return (
    <Image
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      class={props.class ?? "h-4 w-4"}
      onLayout={props.onLayout}
    />
  );
}

/** Layout samples for the geometry regression test. `onLayout` reports bounds
 *  in the element's own parent, so the icon's origin is already relative to
 *  its button: center delta = icon.origin + icon.size/2 - button.size/2. */
export interface IconGeom {
  buttonW: number;
  buttonH: number;
  iconX: number;
  iconY: number;
  iconW: number;
  iconH: number;
  hasButton: boolean;
  hasIcon: boolean;
}
export const iconGeometry: Record<string, IconGeom> = {};
/** Bumped on every layout sample so a test-visible report can render live.
 *  An unsubscribed signal is inert in production; the harness subscribes. */
export const geomTick = signal(0);

function sample(key: string): IconGeom {
  geomTick.update((v) => v + 1);
  return iconGeometry[key] ?? (iconGeometry[key] = {
    buttonW: 0, buttonH: 0, iconX: 0, iconY: 0, iconW: 0, iconH: 0,
    hasButton: false, hasIcon: false,
  });
}

/** Center offset of the icon inside its button, in points. */
export function iconCenterDelta(g: IconGeom): { dx: number; dy: number } {
  return {
    dx: g.iconX + g.iconW / 2 - g.buttonW / 2,
    dy: g.iconY + g.iconH / 2 - g.buttonH / 2,
  };
}

/** The app's palette (`theme.json`), read by scheme.
 *
 *  `token()` in the runtime keeps the appearance the app started in, so an
 *  inverse button (dark on light, light on dark) must take its icon colour
 *  from this table instead of `token("background")`, or the icon keeps the
 *  first scheme's colour and disappears when the user switches. */
export const PALETTE = {
  light: { background: "#f4f6f8", foreground: "#191d24" },
  dark: { background: "#17191b", foreground: "#edf0f1" },
} as const;

/** Icon-only button, mirroring shadcn's `inline-flex items-center justify-center`.
 *  Always centers; `class` supplies size/color/state only. */
export function IconButton(props: {
  testID?: string;
  geomKey?: string;
  name: string;
  onPress: () => void;
  class: string;
  iconClass?: string;
  color?: string;
  label?: string;
  scheme?: string;
  text?: string;
  textClass?: string;
  disabled?: boolean;
  /** Style for a wrapper around the icon (used for the pending spinner). */
  iconStyle?: any;
}) {
  // Only explicitly keyed buttons are sampled. A button without a stable key
  // must not write into the module-level table on every re-render.
  const sampleKey = props.geomKey ?? props.testID ?? null;
  const key = sampleKey ?? "anonymous";
  const iconClass = props.iconClass ?? "h-4 w-4";
  const onContentLayout = (e: any) => {
    if (!sampleKey) return;
    const g = sample(key);
    g.iconX = e.bounds.origin.x;
    g.iconY = e.bounds.origin.y;
    g.iconW = e.bounds.size.width;
    g.iconH = e.bounds.size.height;
    g.hasIcon = true;
  };
  const icon = Icon({
    name: props.name,
    class: iconClass,
    color: props.color,
    scheme: colorScheme(),
    onLayout: onContentLayout,
  });
  const iconEl = props.iconStyle ? <View style={props.iconStyle}>{icon}</View> : icon;
  // Keep icon and Text as DIRECT Button children: NSH only reports onLayout
  // for direct children, so a wrapping View would hide the icon's geometry.
  const content = props.text
    ? [iconEl, <Text class={props.textClass ?? "text-xs text-foreground"} onLayout={onContentLayout}>{props.text}</Text>]
    : iconEl;
  const layout = props.text ? "flex-row items-center justify-center gap-1" : "items-center justify-center";
  return (
    <Button
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.label ?? props.text ?? props.name}
      onLayout={(e: any) => {
        if (!sampleKey) return;
        const g = sample(key);
        g.buttonW = e.bounds.size.width;
        g.buttonH = e.bounds.size.height;
        g.hasButton = true;
      }}
      class={`${layout} ${props.class}`}
    >
      {content}
    </Button>
  );
}
