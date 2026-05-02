interface Props {
  logs: string[];
}

export function LogPanel({ logs }: Props) {
  return (
    <details className="border-border-soft text-fg-muted bg-bg-base max-h-[220px] overflow-y-auto border-t text-xs">
      <summary className="logs-summary border-border-soft bg-bg-softer text-fg-base sticky top-0 z-10 cursor-pointer list-none border-b px-5 py-1.5 select-none">
        日志 ({logs.length})
      </summary>
      <pre className="m-0 px-5 py-1.5 break-all whitespace-pre-wrap select-text">
        {logs.join('\n')}
      </pre>
    </details>
  );
}
