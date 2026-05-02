interface TabDef {
  key: 'songs' | 'played' | 'blacklist';
  label: string;
}

interface Props {
  tabs: TabDef[];
  activeTab: TabDef['key'];
  onTabChange: (tab: TabDef['key']) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: Props) {
  return (
    <nav className="border-border-medium bg-bg-elev flex shrink-0 border-b px-5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={[
            'cursor-pointer border-none bg-transparent px-5 py-2.5 text-sm font-medium transition-colors',
            '-mb-px border-b-2',
            activeTab === tab.key
              ? 'text-accent border-accent'
              : 'text-fg-muted hover:text-fg-base border-transparent',
          ].join(' ')}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
