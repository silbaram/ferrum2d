/* global React, Icon */
function ActivityBar({ active, onChange }) {
  const items = [
    { id: "scene", icon: "layers", label: "Scenes" },
    { id: "files", icon: "files",  label: "Files" },
    { id: "search", icon: "search", label: "Search" },
    { id: "git",   icon: "git",    label: "Git" },
    { id: "plug",  icon: "plug",   label: "Plugins" },
  ];
  return (
    <div className="ab">
      {items.map(it => (
        <button
          key={it.id}
          className={active === it.id ? "active" : ""}
          onClick={() => onChange(it.id)}
          title={it.label}
        >
          <Icon name={it.icon} size={20} stroke={1.5}/>
        </button>
      ))}
      <div style={{flex:1}}/>
      <button title="Settings"><Icon name="settings" size={20} stroke={1.5}/></button>
    </div>
  );
}
window.ActivityBar = ActivityBar;
