interface Props {
  items: string[];
  onRemove: (name: string) => void;
}

export function BlacklistPanel({ items, onRemove }: Props) {
  return (
    <div className="list">
      <div className="list-header">
        <div className="col-uname" />
        <div className="col-song">黑名单歌曲</div>
        <div className="col-actions">操作</div>
      </div>
      <div className="list-body">
        {items.length === 0 && <div className="empty">黑名单为空，右键点歌列表可添加</div>}
        {items.map((name) => (
          <div key={name} className="item">
            <div className="col-uname" />
            <div className="col-song song">{name}</div>
            <div className="col-actions item-actions" style={{ opacity: 1 }}>
              <button onClick={() => onRemove(name)}>移除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
